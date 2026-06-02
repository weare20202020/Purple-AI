import * as readline from 'node:readline'
import type { AgentManager } from '../agent/manager.js'
import type { LogEntry } from '../types.js'
import { BANNER } from '../ui/banner.js'
import { outputGate } from './output-gate.js'
import { setupTerminal } from '../ui/terminal.js'

const DEEP  = '\x1b[38;2;123;79;181m'
const LIGHT = '\x1b[38;2;196;175;240m'
const TEXT  = '\x1b[38;2;255;181;194m'
const GRAD = [
  '\x1b[38;2;107;63;160m',
  '\x1b[38;2;123;79;181m',
  '\x1b[38;2;139;95;200m',
  '\x1b[38;2;158;112;214m',
  '\x1b[38;2;178;131;227m',
  '\x1b[38;2;196;153;238m',
]
const RST = '\x1b[0m'
const DIM = '\x1b[38;2;107;91;123m'
const P = DEEP
const BP = LIGHT
const W = (process.stdout.columns ?? 120) - 4

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[\d;]+m/g, '').length
}

function renderStartup(manager: AgentManager): void {
  const agents = manager.getAllStatus()
  const lines: string[] = []

  const ln = (s: string) => `  ${P}${s}${RST}`
  const bx = (mid: string) => `  ${P}║${RST}${mid}${P}║${RST}`
  const bxp = (mid: string) => `  ${P}║${RST}${P}${mid}${RST}${P}║${RST}`
  const blank = ' '.repeat(W)
  const INNER_W = W - 6

  const blankB = bx(blank)
  lines.push('')
  lines.push(ln(`╔${'═'.repeat(W)}╗`))
  lines.push(blankB)
  for (let i = 0; i < 6; i++) {
    const grad = GRAD[i]
    const bxpGrad = (mid: string) => `  ${DEEP}║${RST}${grad}${mid}${RST}${DEEP}║${RST}`
    const padded = ' '.repeat(Math.floor((W - BANNER[i].length) / 2)) + BANNER[i] + ' '.repeat(Math.ceil((W - BANNER[i].length) / 2))
    lines.push(bxpGrad(padded))
  }
  lines.push(bx(`             ${LIGHT}Multi-Agent Framework${RST}  v0.1.0                          `))
  lines.push(blankB)

  const ip = (l: string, m: string, r: string) => `  ${P}║${RST}  ${l}${m}${r}  ${P}║${RST}`
  const ipad = (s: string) => s + ' '.repeat(Math.max(0, INNER_W - visibleLen(s)))

  lines.push(ip('│', ipad(`${BP}Agent${RST}:`), '│'))
  for (const a of agents) {
    const marker = a.active ? `${BP}>${RST}` : ' '
    const run = a.running ? `${P}●${RST}` : `${P}○${RST}`
    const line = `${marker} ${run} ${TEXT}${a.name}${RST}  ${TEXT}${a.role}${RST}`
    lines.push(ip('│', ipad(line), '│'))
  }
  lines.push(ip('│', ipad('─'.repeat(INNER_W)), '│'))
  lines.push(ip('│', ipad(`${BP}Skill${RST}: ${TEXT}send_message${RST}`), '│'))
  lines.push(ip('│', ipad(`${BP}Model${RST}: ${TEXT}${manager.providerName}${RST}`), '│'))
  lines.push(ip('│', ipad(`${TEXT}/help  for commands${RST}`), '│'))
  lines.push(ip('└', '─'.repeat(INNER_W), '┘'))
  lines.push(blankB)
  lines.push(ln(`╚${'═'.repeat(W)}╝`))
  lines.push('')
  outputGate.write(lines.join('\n') + '\n')
}

function sep(): string {
  return `  ${DEEP}${'─'.repeat(W)}${RST}`
}

function msgBox(label: string, text: string, color: string): string[] {
  const colorCode = color === LIGHT ? LIGHT : DEEP
  const lines = text.split('\n')
  const INNER_W = W - 2
  const result: string[] = []
  result.push(`  ${colorCode}╭${'─'.repeat(W)}╮${RST}`)
  const first = `${colorCode}${label}${RST}: ${TEXT}${lines[0]}${RST}`
  const firstPad = INNER_W - visibleLen(`${label}: `) - visibleLen(lines[0])
  result.push(`  ${colorCode}│${RST} ${first}${' '.repeat(Math.max(0, firstPad))} ${colorCode}│${RST}`)
  for (let i = 1; i < lines.length; i++) {
    const line = `${TEXT}${lines[i]}${RST}`
    const pad = INNER_W - visibleLen(lines[i])
    result.push(`  ${colorCode}│${RST} ${line}${' '.repeat(Math.max(0, pad))} ${colorCode}│${RST}`)
  }
  result.push(`  ${colorCode}╰${'─'.repeat(W)}╯${RST}`)
  return result
}

export class ClassicREPL {
  private rl: readline.Interface
  private manager: AgentManager
  private running = true
  private sessionShown = false
  private verbose = false

  constructor(manager: AgentManager, options?: { verbose?: boolean }) {
    this.manager = manager
    this.verbose = options?.verbose ?? false
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    })
    setupTerminal()
    manager.setOutputCallback((agentId, text) => {
      if (agentId === manager.getActiveId()) this.pushOutput(text)
    })
    manager.setLogCallback((agentId, entry) => {
      if (agentId !== manager.getActiveId()) return
      if (this.verbose) this.pushVerboseLog(entry)
      else if (entry.type === 'send_delivered') {
        const toName = String(entry.data.toName ?? entry.data.to ?? '?')
        this.pushLogMessage(`${toName} 已确认收到消息`)
      }
    })
  }

  async run(): Promise<void> {
    renderStartup(this.manager)
    const rt = this.manager.getActiveRuntime()!
    outputGate.write(`  ${LIGHT}✦${RST} ${rt.profile.name} (${rt.profile.role}) — ${rt.profile.expertise.join(', ')}\n\n`)
    this.showPrompt()
    this.rl.on('line', async (input) => {
      if (!this.running) return
      const t = input.trim()
      outputGate.write(sep() + '\n')
      this.printStatusLine()
      if (t.startsWith('/')) await this.handleCommand(t)
      else if (t) await this.handleUserInput(t)
      if (this.running) this.showPrompt()
    })
  }

  private spinnerChar(): string {
    return '◌'
  }

  private printStatusLine(): void {
    outputGate.write(this.buildStatusLine() + '\n')
  }

  private buildStatusLine(): string {
    const allStatus = this.manager.getAllStatus()
    const working = new Set(this.manager.getWorkingAgentIds())
    const usage = this.manager.getContextUsage()
    const parts: string[] = []
    for (const s of allStatus) {
      const isWorking = s.running && working.has(s.id)
      const marker = !s.running ? `${P}○${RST}`
        : isWorking ? `${LIGHT}${this.spinnerChar()}${RST}`
        : `${P}●${RST}`
      parts.push(`${marker} ${TEXT}${s.name}${RST}`)
    }
    const rt = this.manager.getActiveRuntime()
    const thinking = rt?.isThinking ? ` ${LIGHT}${this.spinnerChar()} 思考中${RST}` : ''
    return `  ${parts.join('  ')}${thinking} ${DEEP}│${RST} ${TEXT}${this.manager.providerName}${RST} ${DEEP}│${RST} ${TEXT}█ ${usage.pct}%${RST}`
  }

  private showPrompt(): void {
    const name = this.manager.getActiveRuntime()?.profile.name ?? '?'
    outputGate.write(`  ${LIGHT}${name}${RST} ❯ ${TEXT}`)
  }

  private async handleUserInput(input: string): Promise<void> {
    const rt = this.manager.getActiveRuntime()
    if (!rt) return

    const userLines = msgBox('User', input, LIGHT)
    outputGate.write(userLines.join('\n') + '\n')

    const response = await rt.processUserInput(input)

    if (!this.sessionShown) {
      const sname = this.manager.getSessionName()
      if (sname) {
        outputGate.write(`  ${DEEP}SESSION${RST}${DEEP}:${RST} ${TEXT}${sname}${RST}\n`)
      }
      this.sessionShown = true
    }

    const agentLines = msgBox(rt.profile.name, response, DEEP)
    outputGate.write(agentLines.join('\n') + '\n')
  }

  pushOutput(text: string): void {
    outputGate.write(`\n  ${TEXT}${text}${RST}\n`)
    this.printStatusLine()
  }

  pushLogMessage(text: string): void {
    outputGate.write(`\n  ${DEEP}系统${RST}: ${TEXT}${text}${RST}\n`)
    this.printStatusLine()
  }

  pushVerboseLog(entry: LogEntry): void {
    const ts = new Date(entry.timestamp).toISOString().slice(11, 19)
    switch (entry.type) {
      case 'tool_call': {
        const name = String(entry.data.agentId ?? '?')
        const tool = String(entry.data.tool ?? '?')
        const args = entry.data.args ? JSON.stringify(entry.data.args).slice(0, 120) : '{}'
        outputGate.write(`  ${DEEP}[${ts}]${RST} ${LIGHT}${name}${RST} → ${P}tool:${RST} ${TEXT}${tool}${RST} ${DIM}(${args})${RST}\n`)
        break
      }
      case 'tool_result': {
        const name = String(entry.data.agentId ?? '?')
        const result = String(entry.data.result ?? '').slice(0, 200)
        outputGate.write(`  ${DEEP}[${ts}]${RST} ${LIGHT}${name}${RST} ← ${P}result:${RST} ${TEXT}${result}${RST}\n`)
        break
      }
      case 'agent_message': {
        const from = String(entry.data.from ?? '?')
        const to = String(entry.data.to ?? '?')
        const content = String(entry.data.content ?? '').slice(0, 200)
        const io = String(entry.data.io ?? '')
        const dir = io === 'out' ? `${P}→${RST}` : `${P}←${RST}`
        outputGate.write(`  ${DEEP}[${ts}]${RST} ${TEXT}${from}${RST} ${dir} ${TEXT}${to}${RST}: ${DIM}${content}${RST}\n`)
        break
      }
      case 'send_delivered': {
        const toName = String(entry.data.toName ?? entry.data.to ?? '?')
        outputGate.write(`  ${DEEP}[${ts}]${RST} ${LIGHT}✓${RST} ${TEXT}${toName}${RST} ${DIM}已确认收到消息${RST}\n`)
        break
      }
    }
    this.printStatusLine()
  }

  stop(): void {
    this.running = false
    this.rl.close()
    outputGate.close()
  }

  private async handleCommand(cmd: string): Promise<void> {
    const parts = cmd.split(/\s+/)
    const command = parts[0].toLowerCase()
    const arg = parts.slice(1).join(' ')

    switch (command) {
      case '/quit':
      case '/exit':
        outputGate.write(`\n  ${LIGHT}Goodbye!${RST}\n`)
        this.stop(); process.exit(0)
        break
      case '/talk': {
        if (!arg) { outputGate.write(`\n  ${DEEP}Usage:${RST} /talk <agent_id>\n`); break }
        try {
          await this.manager.switchAgent(arg.toUpperCase())
          const rt = this.manager.getActiveRuntime()!
          outputGate.write(`\n  ${LIGHT}✦${RST} Switched to ${LIGHT}${rt.profile.name}${RST}\n`)
        } catch { outputGate.write(`\n  ${DEEP}Unknown agent:${RST} ${arg}\n`) }
        break
      }
      case '/agents': {
        outputGate.write('\n')
        for (const a of this.manager.getAllStatus()) {
          const s = a.running ? `${DEEP}●${RST} running` : '○ stopped'
          const act = a.active ? ` ${LIGHT}<-- active${RST}` : ''
          outputGate.write(`  ${DEEP}${a.id}${RST}  ${a.name.padEnd(10)} ${a.role.padEnd(14)} ${s}${act}\n`)
        }
        outputGate.write('\n')
        break
      }
      case '/new': {
        const parts = arg.split(/\s+/)
        const sub = parts[0]?.toLowerCase()

        if (sub === 'agent') {
          const agentName = parts[1]
          const agentRole = parts[2]
          const expertise = parts.slice(3).join(' ').split(',').map(s => s.trim()).filter(Boolean)
          if (!agentName || !agentRole) {
            outputGate.write(`\n  ${DEEP}Usage:${RST} /new agent <name> <role> [expertise,...]\n`)
            break
          }
          try {
            const rt = await this.manager.createAgent(agentName, agentRole, expertise.length > 0 ? expertise : [agentRole])
            outputGate.write(`\n  ${LIGHT}✦${RST} Created and started agent "${rt.profile.name}" (${rt.profile.id}) on port ${rt.profile.port}\n`)
          } catch (e: any) { outputGate.write(`\n  ${DEEP}Error:${RST} ${e.message}\n`) }
          break
        }

        await this.manager.createNewSession()
        const rt = this.manager.getActiveRuntime()
        outputGate.write(`\n  ${LIGHT}✦${RST} New session started — ${rt?.profile.name} is ready.\n`)
        break
      }
      case '/session': {
        if (!arg) {
          const sessions = this.manager.listSessions()
          if (sessions.length === 0) {
            outputGate.write(`\n  ${DEEP}No saved sessions.${RST}\n`)
            break
          }
          outputGate.write('\n')
          const rt = this.manager.getActiveRuntime()
          for (let i = 0; i < sessions.length; i++) {
            const s = sessions[i]
            const active = s.id === rt?.sessionId ? ` ${LIGHT}<-- active${RST}` : ''
            outputGate.write(`  ${DEEP}${i + 1}${RST}  ${s.name.padEnd(20)} ${s.messageCount.toString().padStart(3)} msgs  ${new Date(s.updatedAt).toLocaleString()}${active}\n`)
          }
          outputGate.write(`\n  ${LIGHT}/session <id>${RST} or ${LIGHT}/session <number>${RST} to switch\n`)
        } else {
          const sessions = this.manager.listSessions()
          const idx = parseInt(arg, 10)
          let targetId = arg
          if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) {
            targetId = sessions[idx - 1].id
          }
          const exists = sessions.find(s => s.id === targetId)
          if (!exists) {
            outputGate.write(`\n  ${DEEP}Session not found:${RST} ${arg}\n`)
            break
          }
          await this.manager.switchToSession(targetId)
          outputGate.write(`\n  ${LIGHT}✦${RST} Switched to session "${exists.name}"\n`)
        }
        break
      }
      case '/start': {
        if (!arg) { outputGate.write(`\n  ${DEEP}Usage:${RST} /start <agent_id>\n`); break }
        try {
          const rt = await this.manager.startAgent(arg.toUpperCase())
          outputGate.write(`\n  ${LIGHT}✦${RST} Started ${LIGHT}${rt.profile.name}${RST}\n`)
        } catch { outputGate.write(`\n  ${DEEP}Unknown agent:${RST} ${arg}\n`) }
        break
      }
      case '/default': {
        if (!arg) { outputGate.write(`\n  ${DEEP}Default:${RST} ${this.manager.defaultId}\n`); break }
        const id = arg.toUpperCase()
        if (!this.manager.getAllStatus().find(a => a.id === id)) { outputGate.write(`\n  ${DEEP}Unknown:${RST} ${id}\n`); break }
        this.manager.defaultId = id
        outputGate.write(`\n  ${DEEP}Default set to${RST} ${LIGHT}${id}${RST}\n`)
        break
      }
      case '/help':
        outputGate.write(`\n  ${LIGHT}/talk <id>${RST}          Switch agent\n  ${LIGHT}/agents${RST}             List agents\n  ${LIGHT}/new${RST}                 New session\n  ${LIGHT}/new agent <n> <r>${RST}   Create & start a new agent\n  ${LIGHT}/session [id]${RST}         List / switch session\n  ${LIGHT}/default <id>${RST}       Set default agent\n  ${LIGHT}/start <id>${RST}         Start agent\n  ${LIGHT}/status${RST}             Session info\n  ${LIGHT}/index${RST}              Rebuild file index\n  ${LIGHT}/help${RST}               This help\n  ${LIGHT}/quit${RST}               Exit\n`)
        break
      case '/status': {
        const rt = this.manager.getActiveRuntime()
        const usage = this.manager.getContextUsage()
        outputGate.write(`\n  ${DEEP}Active:${RST} ${LIGHT}${rt?.profile.name}${RST} (${rt?.profile.id})\n  ${DEEP}Model:${RST} ${this.manager.providerName}\n  ${DEEP}Context:${RST} ${TEXT}${usage.used} / ${usage.limit} (${usage.pct}%)${RST}\n`)
        break
      }
      case '/index': {
        const rt = this.manager.getActiveRuntime()
        if (!rt) break
        try {
          const { buildPageIndex } = await import('../memory/page-index.js')
          const entries = await buildPageIndex(rt.workspace)
          outputGate.write(`\n  ${LIGHT}✦${RST} Indexed ${entries.length} files\n`)
        } catch (e: any) { outputGate.write(`\n  ${DEEP}Error:${RST} ${e.message}\n`) }
        break
      }
      default:
        outputGate.write(`\n  ${DEEP}Unknown:${RST} ${command}. Type ${LIGHT}/help${RST}\n`)
    }
  }
}