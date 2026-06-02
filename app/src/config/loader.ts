import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import os from 'node:os'

let _cachedRoot: string | null = null

function findProjectRoot(): string {
  if (_cachedRoot) return _cachedRoot
  let dir = resolve(import.meta.dirname ?? process.cwd(), '..', '..')
  while (!existsSync(resolve(dir, 'package.json'))) {
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  _cachedRoot = dir
  return dir
}

function findOpenCodeConfig(): Record<string, unknown> | null {
  const home = os.homedir()
  const paths = [
    resolve(home, '.config', 'opencode', 'opencode.json'),
    resolve(home, '.config', 'opencode', 'opencode.jsonc'),
    resolve(home, '.opencode.json'),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'))
      } catch { continue }
    }
  }
  return null
}

export interface AgentEntry {
  id: string
  name: string
  role: string
  port: number
  expertise: string[]
}

export interface LLMSettings {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
}

export interface GlobalSettings {
  llm: LLMSettings
  defaultAgent?: string
}

export function loadAgents(): AgentEntry[] {
  const root = findProjectRoot()
  const p = resolve(root, 'config', 'agents.json')
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf-8'))
}

export function findAgent(id: string): AgentEntry | undefined {
  return loadAgents().find(a => a.id === id)
}

export function nextAgentId(): string {
  const agents = loadAgents()
  const used = new Set(agents.map(a => a.id))
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i)
    if (!used.has(id)) return id
  }
  return `X${agents.length + 1}`
}

export function nextPort(): number {
  const agents = loadAgents()
  const used = new Set(agents.map(a => a.port))
  for (let port = 3000; port < 3100; port++) {
    if (!used.has(port)) return port
  }
  return 3100 + agents.length
}

export function addAgent(entry: AgentEntry): void {
  const root = findProjectRoot()
  const p = resolve(root, 'config', 'agents.json')
  const agents = loadAgents()
  agents.push(entry)
  writeFileSync(p, JSON.stringify(agents, null, 2), 'utf-8')
}

export function loadGlobalConfig(): GlobalSettings {
  const root = findProjectRoot()
  const p = resolve(root, 'config', 'default.json')

  let cfg: GlobalSettings = {
    llm: { provider: 'openai', apiKey: '', model: 'gpt-4o' },
    defaultAgent: 'A',
  }

  if (existsSync(p)) {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'))
    cfg = {
      llm: {
        provider: parsed.llm?.provider ?? 'openai',
        apiKey: parsed.llm?.apiKey ?? '',
        model: parsed.llm?.model ?? 'gpt-4o',
        baseUrl: parsed.llm?.baseUrl,
      },
      defaultAgent: parsed.defaultAgent ?? 'A',
    }
  }

  // Auto-detect DeepSeek API key & model from OpenCode config
  if (!cfg.llm.apiKey) {
    const opencode = findOpenCodeConfig()
    if (opencode) {
      const provider = (opencode as any).provider
      if (provider?.DeepSeek?.options?.apiKey) {
        cfg.llm.provider = 'deepseek'
        cfg.llm.apiKey = provider.DeepSeek.options.apiKey
        cfg.llm.baseUrl = provider.DeepSeek.options.baseURL || 'https://api.deepseek.com'
        const models = provider.DeepSeek.models
        if (models) {
          const names = Object.keys(models)
          cfg.llm.model = names.includes('deepseek-v4-flash') ? 'deepseek-v4-flash'
            : names.includes('deepseek-v4-pro') ? 'deepseek-v4-pro'
            : names[0] || 'deepseek-chat'
        } else {
          cfg.llm.model = cfg.llm.model || 'deepseek-chat'
        }
      }
    }
  }

  // Fallback to env vars
  if (!cfg.llm.apiKey) {
    cfg.llm.apiKey = process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ''
  }

  return cfg
}
