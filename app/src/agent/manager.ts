import { AgentRuntime } from './runtime.js'
import { findAgent, loadAgents, loadGlobalConfig, addAgent, nextAgentId, nextPort } from '../config/loader.js'
import { registerProvider } from '../llm/registry.js'
import { OpenAIProvider } from '../llm/openai.js'
import { DeepSeekProvider } from '../llm/deepseek.js'
import { AnthropicProvider } from '../llm/anthropic.js'
import type { LogEntry } from '../types.js'
import path from 'node:path'
import process from 'node:process'

registerProvider(new OpenAIProvider())
registerProvider(new DeepSeekProvider())
registerProvider(new AnthropicProvider())

export interface AgentStatus {
  id: string
  name: string
  role: string
  expertise: string[]
  running: boolean
  active: boolean
}

export class AgentManager {
  private agents = new Map<string, AgentRuntime>()
  private activeId: string
  private _defaultId: string
  private _outputCallback: ((agentId: string, text: string) => void) | null = null
  private _logCallback: ((agentId: string, entry: LogEntry) => void) | null = null
  private _workingUpdateCallback: ((working: string[]) => void) | null = null

  constructor(defaultId: string) {
    this.activeId = defaultId
    this._defaultId = defaultId
  }

  get defaultId(): string { return this._defaultId }
  set defaultId(id: string) { this._defaultId = id }

  setOutputCallback(cb: (agentId: string, text: string) => void): void {
    this._outputCallback = cb
  }

  setLogCallback(cb: (agentId: string, entry: LogEntry) => void): void {
    this._logCallback = cb
  }

  setOnWorkingUpdate(cb: (working: string[]) => void): void {
    this._workingUpdateCallback = cb
  }

  async startAgent(id: string): Promise<AgentRuntime> {
    const existing = this.agents.get(id)
    if (existing) return existing

    const profile = findAgent(id)
    if (!profile) throw new Error(`Unknown agent: ${id}`)

    const dataDir = path.join(process.cwd(), 'data', profile.id)
    const runtime = new AgentRuntime({ ...profile, port: profile.port }, dataDir)

    const cfg = loadGlobalConfig()
    runtime.setLLM(
      cfg.llm.provider,
      cfg.llm.apiKey || process.env.OPENAI_API_KEY || '',
      cfg.llm.model,
    )

    runtime.onOutput = (text) => {
      this._outputCallback?.(id, text)
    }

    runtime.onLog = (entry) => {
      this._logCallback?.(id, entry)
    }

    runtime.manager = this
    runtime.onWorkingUpdate = (_ids) => {
      this._workingUpdateCallback?.(this.getWorkingAgentIds())
    }

    await runtime.start()
    this.agents.set(id, runtime)
    return runtime
  }

  getActiveRuntime(): AgentRuntime | undefined {
    return this.agents.get(this.activeId)
  }

  getAgent(id: string): AgentRuntime | undefined {
    return this.agents.get(id)
  }

  getActiveId(): string {
    return this.activeId
  }

  getAllStatus(): AgentStatus[] {
    return loadAgents().map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      expertise: a.expertise,
      running: this.agents.has(a.id),
      active: a.id === this.activeId,
    }))
  }

  getWorkingAgentIds(): string[] {
    const ids = new Set<string>()
    for (const rt of this.agents.values()) {
      for (const w of rt.getWorkingAgents()) {
        ids.add(w)
      }
    }
    return Array.from(ids)
  }

  async switchAgent(id: string): Promise<AgentRuntime> {
    if (!this.agents.has(id)) {
      await this.startAgent(id)
    }
    this.activeId = id
    return this.agents.get(id)!
  }

  get contextHistoryLength(): number {
    const rt = this.getActiveRuntime()
    return rt ? rt.contextLength : 0
  }

  get providerName(): string {
    const cfg = loadGlobalConfig()
    return `${cfg.llm.provider} / ${cfg.llm.model}`
  }

  getContextUsage(): { used: number; limit: number; pct: number } {
    const rt = this.getActiveRuntime()
    return rt ? rt.getContextUsage() : { used: 0, limit: 128000, pct: 0 }
  }

  getSessionName(): string {
    return this.getActiveRuntime()?.sessionName ?? ''
  }

  async createNewSession(): Promise<void> {
    const rt = this.getActiveRuntime()
    if (rt) await rt.newSession()
  }

  listSessions(): import('./runtime.js').SessionMeta[] {
    return this.getActiveRuntime()?.listSessions() ?? []
  }

  async switchToSession(id: string): Promise<void> {
    const rt = this.getActiveRuntime()
    if (rt) await rt.switchToSession(id)
  }

  async createAgent(name: string, role: string, expertise: string[]): Promise<AgentRuntime> {
    const id = nextAgentId()
    const port = nextPort()
    const entry = { id, name, role, port, expertise }
    addAgent(entry)
    return this.startAgent(id)
  }
}
