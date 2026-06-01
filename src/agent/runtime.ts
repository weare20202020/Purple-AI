import type { AgentProfile, Message } from '../types.js'
import { loadAgents } from '../config/loader.js'
import { Inbox } from '../message/inbox.js'
import { MessageServer } from '../network/server.js'
import { sendMessage as networkSend } from '../network/client.js'
import { registerSkill, getSkill, getAllSkills } from '../skill/registry.js'
import { sendMessageSkill } from '../skill/send-message.js'
import type { SkillContext } from '../skill/types.js'
import { getProvider } from '../llm/registry.js'
import type { LLMMessage, LLMResponse, ToolCall } from '../llm/types.js'
import { zodToJsonSchema } from '../llm/zod-to-json.js'
import { registerTool, getTool, getAllTools } from '../tools/registry.js'
import type { ToolContext } from '../tools/types.js'
import { readFileTool } from '../tools/read-file.js'
import { listDirTool } from '../tools/list-dir.js'
import { writeFileTool } from '../tools/write-file.js'
import { grepSearchTool } from '../tools/grep-search.js'
import { runCommandTool } from '../tools/run-command.js'
import { editFileTool } from '../tools/edit-file.js'
import path from 'node:path'
import process from 'node:process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { retrieveRelevant, formatExperiences, saveExperience, computeRelevance } from '../memory/experience.js'
import type { Experience } from '../memory/experience.js'
import { buildPageIndex, loadPageIndex, formatPageIndexShort, pageIndexAge } from '../memory/page-index.js'

export const CONTEXT_LIMIT = 128000

function repairHistory(history: LLMMessage[]): LLMMessage[] {
  return history.map(m => {
    if (m.role === 'tool' && !m.tool_call_id) {
      return { role: 'user' as const, content: `[Tool result]: ${m.content ?? ''}` }
    }
    return m
  })
}

function estimateTokens(text: string): number {
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 128) tokens += 0.25
    else if (code >= 0x4E00 && code <= 0x9FFF) tokens += 0.6
    else tokens += 0.35
  }
  return Math.max(1, Math.ceil(tokens))
}

function estimateEntryTokens(m: LLMMessage): number {
  let t = estimateTokens(m.content ?? '')
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      t += estimateTokens(tc.name + tc.arguments)
    }
  }
  return t
}

const MEMORY_COMPRESS_THRESHOLD = 0.7
const COMPRESS_TRIGGER_STEP = 8
const REFLECTION_INTERVAL = 5

export interface SessionMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export class AgentRuntime {
  readonly profile: AgentProfile
  private inbox: Inbox
  private server: MessageServer
  private llmProviderName: string
  private llmApiKey: string
  private llmModel: string
  reflectionModel?: string // separate model for reflection, defaults to llmModel
  private conversationHistory: LLMMessage[] = []
  private workingAgents: Set<string> = new Set()
  private dataDir: string
  private totalTokens = 0
  private processingInbox = false
  sessionId = ''
  sessionName = ''
  workspace: string
  maxReActSteps = 12

  manager: { switchAgent: (id: string) => Promise<unknown>; startAgent: (id: string) => Promise<AgentRuntime>; getAgent: (id: string) => AgentRuntime | undefined; getActiveId: () => string } | null = null
  onOutput?: (text: string) => void
  onWorkingUpdate?: (agents: string[]) => void

  get contextLength(): number {
    return this.conversationHistory.length
  }

  getContextUsage(): { used: number; limit: number; pct: number } {
    return {
      used: this.totalTokens,
      limit: CONTEXT_LIMIT,
      pct: Math.min(100, Math.round((this.totalTokens / CONTEXT_LIMIT) * 100)),
    }
  }

  private get sessionsDir(): string {
    return path.join(this.dataDir, 'sessions')
  }

  private get indexFile(): string {
    return path.join(this.sessionsDir, 'index.json')
  }

  constructor(profile: AgentProfile, dataDir: string) {
    this.profile = profile
    this.dataDir = dataDir
    this.workspace = process.cwd()

    this.inbox = new Inbox(path.join(dataDir, 'inbox.json'))
    this.server = new MessageServer(profile.port, (msg) => this.handleIncoming(msg))

    registerSkill(sendMessageSkill)

    registerTool(readFileTool)
    registerTool(listDirTool)
    registerTool(writeFileTool)
    registerTool(grepSearchTool)
    registerTool(runCommandTool)
    registerTool(editFileTool)

    this.llmProviderName = 'openai'
    this.llmApiKey = process.env.OPENAI_API_KEY ?? ''
    this.llmModel = process.env.LLM_MODEL ?? 'gpt-4o'
  }

  setLLM(provider: string, apiKey: string, model: string): void {
    this.llmProviderName = provider
    this.llmApiKey = apiKey
    this.llmModel = model
  }

  async start(): Promise<void> {
    await this.inbox.load()
    await this.loadSession()
    await this.server.listen(this.profile.port)
    // drain any unprocessed messages from previous run
    this.drainInbox()
    // build page index on startup
    try {
      const age = pageIndexAge()
      if (age < 0 || age > 300_000) { // build if missing or older than 5 min
        await buildPageIndex(this.workspace)
      }
    } catch { /* non-critical */ }
  }

  private async drainInbox(): Promise<void> {
    if (this.processingInbox) return
    this.processingInbox = true
    try {
      while (this.inbox.length > 0) {
        const msg = await this.inbox.pull()
        if (msg) await this.processIncomingMessage(msg)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${this.profile.id}] Inbox error: ${msg}`)
    } finally {
      this.processingInbox = false
      this.updateWorkingStatus()
    }
  }

  private async handleIncoming(msg: Message): Promise<void> {
    await this.inbox.push(msg)
    this.drainInbox()
  }

  async processUserInput(input: string): Promise<string> {
    // lock: block inbox processing while user is chatting
    this.processingInbox = true
    try {
      return await this._processUserInput(input)
    } finally {
      this.processingInbox = false
      this.drainInbox()
    }
  }

  private async _processUserInput(input: string): Promise<string> {
    const isFirst = this.conversationHistory.length === 0
    this.addToHistory({ role: 'user', content: input })
    if (isFirst) {
      this.sessionName = this.generateSessionName(input)
      if (!this.sessionId) this.sessionId = randomUUID()
    }

    for (let step = 0; step < this.maxReActSteps; step++) {
      const response = await this.callLLM()
      this.addToHistory({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      })

      if (!response.toolCalls || response.toolCalls.length === 0) {
        await this.saveSession()
        await this.saveExperienceCard(input, response.content ?? '')
        return response.content?.trim() ? response.content : '[Done]'
      }

      for (const tc of response.toolCalls) {
        const args = this.parseArgs(tc.arguments)
        let result: string
        if (tc.name === 'send_message') {
          result = await this.executeSkill(tc.name, args)
        } else {
          result = await this.executeTool(tc.name, args)
        }
        this.addToHistory({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        })
      }
      this.stepsSinceLastCompress = (this.stepsSinceLastCompress ?? 0) + 1

      // reflection every N steps
      if ((step + 1) % REFLECTION_INTERVAL === 0) {
        const reflection = await this.reflect()
        this.addToHistory({ role: 'system', content: `[Reflection at step ${step + 1}]\n${reflection}` })
      }
    }

    await this.saveSession()
    await this.saveExperienceCard(input, '[Reached max reasoning steps]')
    return '[Reached max reasoning steps]'
  }

  private parseArgs(args: string): Record<string, unknown> {
    try { return JSON.parse(args) } catch { return { _raw: args } }
  }

  private async reflect(): Promise<string> {
    const provider = getProvider(this.llmProviderName)
    if (!provider || !this.llmApiKey) return ''
    const model = this.reflectionModel || this.llmModel
    const recentActivity = this.conversationHistory.slice(-6).map(m => {
      const text = m.content ?? (m.tool_calls ? `[Tool calls: ${m.tool_calls.map(tc => tc.name).join(', ')}]` : '')
      return `[${m.role}] ${text.slice(0, 500)}`
    }).join('\n\n')
    try {
      const res = await provider.generate([
        { role: 'system', content: `You are doing self-reflection on your recent work. Analyze:
1. Progress toward the goal — are you on track?
2. Any mistakes or suboptimal decisions
3. What should you do differently next?
4. Do you have enough information to finish?

Keep your reflection concise (2-3 paragraphs). Focus on practical adjustments.` },
        { role: 'user', content: `Recent conversation:\n${recentActivity}` },
      ], this.llmApiKey, model)
      return res.content ?? ''
    } catch {
      return '(reflection skipped)'
    }
  }

  async processIncomingMessage(msg: Message): Promise<void> {
    const senderName = this.getAgentName(msg.from)
    const inject: LLMMessage = {
      role: 'user',
      content: `[From ${senderName} (${msg.from}) via team message]\nType: ${msg.type}\n${msg.content}`,
    }
    this.addToHistory(inject)

    for (let step = 0; step < this.maxReActSteps; step++) {
      const response = await this.callLLM()
      this.addToHistory({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      })

      if (!response.toolCalls || response.toolCalls.length === 0) {
        await this.saveSession()
        this.workingAgents.delete(msg.from)

        if (msg.from && msg.type === 'task') {
          const target = loadAgents().find(a => a.id === msg.from)
          if (target) {
            const text = response.content?.trim() ? response.content : ''
            const reply: Message = {
              id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date().toISOString(),
              from: this.profile.id,
              to: msg.from,
              type: 'result',
              content: text,
            }
            await networkSend(target.port, reply)
          }
        }

        this.onOutput?.(response.content?.trim() ? response.content : '')
        return
      }

      for (const tc of response.toolCalls) {
        const args = this.parseArgs(tc.arguments)
        let result: string
        if (tc.name === 'send_message') {
          result = await this.executeSkill(tc.name, args)
        } else {
          result = await this.executeTool(tc.name, args)
        }
        this.addToHistory({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        })
      }
      this.stepsSinceLastCompress = (this.stepsSinceLastCompress ?? 0) + 1

      // reflection every N steps
      if ((step + 1) % REFLECTION_INTERVAL === 0) {
        const reflection = await this.reflect()
        this.addToHistory({ role: 'system', content: `[Reflection at step ${step + 1}]\n${reflection}` })
      }
    }

    await this.saveSession()
    this.workingAgents.delete(msg.from)
    this.onOutput?.('[Reached max reasoning steps]')
  }

  onTaskSent(agentId: string): void {
    this.workingAgents.add(agentId)
  }

  onTaskCompleted(agentId: string): void {
    this.workingAgents.delete(agentId)
  }

  private updateWorkingStatus(): void {
    const names = Array.from(this.workingAgents)
    this.onWorkingUpdate?.(names)
  }

  private getAgentName(id: string): string {
    const agents = loadAgents()
    return agents.find(a => a.id === id)?.name ?? id
  }

  private async buildSystemPrompt(): Promise<string> {
    const coworkers = loadAgents().filter(a => a.id !== this.profile.id)
    const coworkerList = coworkers.length === 0
      ? 'None'
      : coworkers.map(c => `- ${c.name} (${c.id}): ${c.role}, expertise: ${c.expertise.join(', ')}`).join('\n')

    const tools = getAllTools()
    const toolList = tools.map(t => {
      const shape = t.schema._def?.shape ?? {}
      const params = Object.entries(shape).map(([k, v]: [string, any]) => {
        const opt = v.isOptional?.() ? '?' : ''
        const type = v._def?.type ?? v.constructor.name?.replace('Zod', '').toLowerCase() ?? 'string'
        return `  ${k}${opt}: ${type}`
      }).join('\n')
      return `- ${t.name}: ${t.description}\n${params}`
    }).join('\n\n')

    const skills = getAllSkills()
    const skillList = skills.map(s => {
      const shape = s.schema._def?.shape ?? {}
      const params = Object.entries(shape).map(([k, v]: [string, any]) => {
        const opt = v.isOptional?.() ? '?' : ''
        const type = v._def?.type ?? v.constructor.name?.replace('Zod', '').toLowerCase() ?? 'string'
        return `  ${k}${opt}: ${type}`
      }).join('\n')
      return `- ${s.name}: ${s.description}\n${params}`
    }).join('\n\n')

    const pageEntries = await loadPageIndex()
    const pageIndexBlock = pageEntries.length > 0
      ? '\n\nProject files:\n' + formatPageIndexShort(pageEntries, 25)
      : ''

    // retrieve relevant past experiences
    const firstMsg = this.conversationHistory.find(m => m.role === 'user')
    let experienceBlock = ''
    if (firstMsg?.content) {
      const exps = await retrieveRelevant(this.profile.id, firstMsg.content)
      if (exps.length > 0) {
        experienceBlock = '\n\nRelevant past experiences:\n' + formatExperiences(exps)
      }
    }

    return `You are ${this.profile.name}, a ${this.profile.role} with expertise in ${this.profile.expertise.join(', ')}.

IMPORTANT: You are running in a real agent harness. ALL tools listed below are real and functional. You CAN read files, write files, edit files, run commands, and send messages to other agents. When the user asks about your capabilities, describe the tools you have access to. Do NOT say you can't do something — if a tool exists for it, you can do it.

Your team members:
${coworkerList}

Available tools:
${toolList || 'None'}

Available skills (for team coordination):
${skillList || 'None'}${pageIndexBlock}${experienceBlock}
Rules:
1. You work in a team of AI agents. You can delegate tasks to colleagues using the send_message tool.
2. Messages from the user appear as normal "user" messages.
3. Messages from colleagues appear as "[From Name (id) via team message]".
4. When you need to delegate, use the send_message tool with the correct parameters.
5. After delegating, continue your response naturally. The colleague will respond when done.
6. When a colleague responds, summarize their results naturally for the user.
7. You NEVER need to wait synchronously. Send the task and move on.
8. For code changes, prefer edit_file over write_file — it preserves context and supports rollback.
9. When editing a file, use oldStr/newStr to find and replace the exact text you want to change.
10. If you find relevant past experiences (listed above), apply lessons learned from them.
11. Use the project file listing above to find files quickly — paths are relative to workspace root.
12. When the user asks "what can you do?" or similar, answer confidently with your tool list.

You can call multiple tools in a single step when they are independent. After tool results are returned, continue reasoning and call more tools if needed, or provide your final response.`
  }

  private async callLLM(): Promise<LLMResponse> {
    await this.maybeCompressMemory()
    const provider = getProvider(this.llmProviderName)
    if (!provider) {
      return { content: `[LLM provider "${this.llmProviderName}" not configured. Set OPENAI_API_KEY or configure config/default.json]` }
    }
    if (!this.llmApiKey) {
      return { content: `[API key not configured. Set OPENAI_API_KEY environment variable or configure config/default.json]` }
    }

    const tools = getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.schema),
    }))

    const skill = getSkill('send_message')
    if (skill) {
      tools.push({
        name: skill.name,
        description: skill.description,
        parameters: zodToJsonSchema(skill.schema),
      })
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: await this.buildSystemPrompt() },
      ...this.conversationHistory.map(m => {
        if (m.role === 'system') return { ...m, role: 'assistant' as const }
        if (m.role === 'tool' && !m.tool_call_id) return { role: 'user' as const, content: `[Tool result]: ${m.content ?? ''}` }
        return m
      }),
    ]
    try {
      return await provider.generate(messages, this.llmApiKey, this.llmModel,
        tools.length > 0 ? tools : undefined)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: `[LLM API error: ${msg}]` }
    }
  }

  private addToHistory(msg: {
    role: 'user' | 'assistant' | 'tool' | 'system'
    content?: string | null
    tool_calls?: ToolCall[]
    tool_call_id?: string
  }): void {
    const entry: LLMMessage = {
      role: msg.role,
      content: msg.content ?? null,
      tool_calls: msg.tool_calls,
      tool_call_id: msg.tool_call_id,
    }
    this.conversationHistory.push(entry)
    this.totalTokens += estimateEntryTokens(entry)
    if (this.conversationHistory.length > 100) {
      const removed = this.conversationHistory.shift()!
      this.totalTokens -= estimateEntryTokens(removed)
      while (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'tool') {
        const orphan = this.conversationHistory.shift()!
        this.totalTokens -= estimateEntryTokens(orphan)
      }
    }
  }

  private async maybeCompressMemory(): Promise<void> {
    const usage = this.getContextUsage()
    if (usage.pct < MEMORY_COMPRESS_THRESHOLD * 100) return
    const stepsSinceCompress = this.stepsSinceLastCompress ?? 0
    if (stepsSinceCompress < COMPRESS_TRIGGER_STEP) return

    const msgs = this.conversationHistory
    if (msgs.length < 6) return

    // summarize the first half of history
    const half = Math.floor(msgs.length / 2)
    let splitIdx = half
    // avoid splitting between assistant(tool_calls) and its tool results
    while (splitIdx < msgs.length && msgs[splitIdx].role === 'tool') {
      splitIdx++
    }
    const toSummarize = msgs.slice(0, splitIdx).map(m => {
      const content = m.content ?? (m.tool_calls ? `[Tool calls: ${m.tool_calls.map(tc => tc.name).join(', ')}]` : '')
      return `[${m.role}] ${content}`
    }).join('\n\n')
    const recent = msgs.slice(half)

    const summary = await this.callLLMForSummary(toSummarize)
    if (!summary) return

    this.conversationHistory = [
      { role: 'system', content: `[Memory Summary: ${this.sessionName}]\n${summary}` },
      ...recent,
    ]
    this.totalTokens = this.conversationHistory.reduce((a, m) => a + estimateEntryTokens(m), 0)
    this.stepsSinceLastCompress = 0
  }

  private stepsSinceLastCompress = 0

  private async callLLMForSummary(text: string): Promise<string | null> {
    const provider = getProvider(this.llmProviderName)
    if (!provider || !this.llmApiKey) return null
    try {
      const res = await provider.generate([
        { role: 'system', content: 'Summarize the conversation so far. Extract: goal, key decisions, current plan, next actions, important findings. Be concise.' },
        { role: 'user', content: text },
      ], this.llmApiKey, this.llmModel)
      return res.content
    } catch {
      return null
    }
  }

  private async saveExperienceCard(input: string, output: string): Promise<void> {
    if (!this.sessionName || this.sessionName === 'CHAT') return
    const provider = getProvider(this.llmProviderName)
    if (!provider || !this.llmApiKey) return
    try {
      const res = await provider.generate([
        { role: 'system', content: 'You are an experience extractor. Given a user request and the agent response, produce a concise experience card in this format:\nGoal: <goal>\nType: <task type>\nSummary: <1-2 sentence summary>\nKeyDecisions: <comma separated>\nFindings: <key lessons>\nSuccess: <true/false>\nTags: <comma separated tags>' },
        { role: 'user', content: `User: ${input}\nResponse: ${output}` },
      ], this.llmApiKey, this.llmModel)
      const summary = res.content ?? ''
      const lines = summary.split('\n').map(l => l.replace(/^\d+\.\s*/, ''))
      const get = (prefix: string): string => {
        const line = lines.find(l => l.toLowerCase().startsWith(prefix.toLowerCase()))
        return line ? line.split(':').slice(1).join(':').trim() : ''
      }
      const exp: Experience = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        goal: get('Goal') || this.sessionName,
        taskType: get('Type') || 'general',
        summary: get('Summary') || summary.slice(0, 200),
        keyDecisions: get('KeyDecisions').split(',').map(s => s.trim()).filter(Boolean),
        findings: get('Findings') || '',
        success: get('Success').toLowerCase() === 'true',
        tags: get('Tags').split(',').map(s => s.trim()).filter(Boolean),
      }
      await saveExperience(this.profile.id, exp)
    } catch { /* experience save is best-effort */ }
  }

  private generateSessionName(input: string): string {
    const clean = input.replace(/[^\w\s\u4e00-\u9fff]/g, '').trim()
    const words = clean.split(/\s+/).filter(Boolean)
    if (words.length === 0) return 'CHAT'
    const name = words.slice(0, 3).join('_').toUpperCase()
    return name.length > 30 ? name.slice(0, 30) : name
  }

  private async ensureSessionsDir(): Promise<void> {
    if (!existsSync(this.sessionsDir)) {
      await mkdir(this.sessionsDir, { recursive: true })
    }
  }

  private async readIndex(): Promise<SessionMeta[]> {
    if (!existsSync(this.indexFile)) return []
    try {
      const raw = await readFile(this.indexFile, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  private async writeIndex(meta: SessionMeta[]): Promise<void> {
    await this.ensureSessionsDir()
    await writeFile(this.indexFile, JSON.stringify(meta, null, 2), 'utf-8')
  }

  async newSession(): Promise<void> {
    if (this.sessionId) {
      await this.saveSession()
    }
    this.sessionId = randomUUID()
    this.sessionName = ''
    this.conversationHistory = []
    this.totalTokens = 0
  }

  private readIndexSync(): SessionMeta[] {
    if (!existsSync(this.indexFile)) return []
    try {
      const raw = readFileSync(this.indexFile, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  listSessions(): SessionMeta[] {
    return this.readIndexSync()
  }

  async switchToSession(id: string): Promise<void> {
    // archive current first
    await this.saveSession()

    const filePath = path.join(this.sessionsDir, `${id}.json`)
    if (!existsSync(filePath)) return

    try {
      const raw = await readFile(filePath, 'utf-8')
      const data = JSON.parse(raw)
      this.sessionId = data.id ?? id
      this.sessionName = data.name ?? ''
      this.totalTokens = data.totalTokens ?? 0
      this.conversationHistory = Array.isArray(data.conversationHistory) ? repairHistory(data.conversationHistory) : []
    } catch {
      // corrupt, ignore
    }
  }

  private async archiveCurrentSession(): Promise<void> {
    if (!this.sessionId) return
    if (this.conversationHistory.length === 0) return
    if (!this.sessionName) {
      // pick first user message as name
      const first = this.conversationHistory.find(m => m.role === 'user')
      if (first?.content) this.sessionName = this.generateSessionName(first.content)
    }

    await this.ensureSessionsDir()

    const data = {
      id: this.sessionId,
      name: this.sessionName || 'CHAT',
      createdAt: '', // keep existing if set
      updatedAt: new Date().toISOString(),
      conversationHistory: this.conversationHistory,
      totalTokens: this.totalTokens,
    }

    // preserve createdAt if the session file already exists
    const existingPath = path.join(this.sessionsDir, `${this.sessionId}.json`)
    if (existsSync(existingPath)) {
      try {
        const old = JSON.parse(await readFile(existingPath, 'utf-8'))
        data.createdAt = old.createdAt ?? new Date().toISOString()
      } catch { /* ignore */ }
    } else {
      data.createdAt = new Date().toISOString()
    }

    await writeFile(existingPath, JSON.stringify(data, null, 2), 'utf-8')

    // update index
    const index = await this.readIndex()
    const existing = index.findIndex(s => s.id === this.sessionId)
    const meta: SessionMeta = {
      id: this.sessionId,
      name: data.name,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      messageCount: this.conversationHistory.length,
    }
    if (existing >= 0) {
      index[existing] = meta
    } else {
      index.push(meta)
    }
    await this.writeIndex(index)
  }

  private async saveSession(): Promise<void> {
    await this.archiveCurrentSession()
  }

  private async loadSession(): Promise<void> {
    // Try sessions/ directory first
    if (existsSync(this.sessionsDir)) {
      const index = await this.readIndex()
      if (index.length > 0) {
        const last = index[index.length - 1]
        await this.switchToSession(last.id)
        return
      }
    }

    // Backward compat: migrate old session.json
    const oldPath = path.join(this.dataDir, 'session.json')
    if (!existsSync(oldPath)) {
      // brand new — create first session
      this.sessionId = randomUUID()
      return
    }

    try {
      const raw = await readFile(oldPath, 'utf-8')
      const old = JSON.parse(raw)
      const id = randomUUID()
      this.sessionId = id
      this.sessionName = old.sessionName ?? ''
      this.totalTokens = old.totalTokens ?? 0
      this.conversationHistory = Array.isArray(old.conversationHistory) ? repairHistory(old.conversationHistory) : []

      // migrate to new format
      await this.archiveCurrentSession()
    } catch {
      this.sessionId = randomUUID()
    }
  }

  private async executeTool(name: string, params: Record<string, unknown>): Promise<string> {
    const tool = getTool(name)
    if (!tool) return `[Unknown tool: ${name}]`
    const ctx: ToolContext = { workspace: this.workspace, runtime: this }
    try {
      return await tool.execute(params, ctx)
    } catch (e: any) {
      return `[Tool error: ${e.message}]`
    }
  }

  private async executeSkill(name: string, params: Record<string, unknown>): Promise<string> {
    const skill = getSkill(name)
    if (!skill) return `[Unknown skill: ${name}]`
    const ctx: SkillContext = { runtime: this }
    const parsed = skill.schema.safeParse(params)
    if (!parsed.success) {
      console.error(`[${this.profile.id}] Skill "${name}" validation error:`, parsed.error.issues)
      return `[Skill error: validation failed]`
    }
    try {
      const result = await skill.execute(parsed.data, ctx)
      return JSON.stringify(result)
    } catch (e: any) {
      return `[Skill error: ${e.message}]`
    }
  }
}
