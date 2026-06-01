import { Command } from 'commander'
import { AgentManager } from '../agent/manager.js'
import { REPL } from '../repl/index.js'
import { loadAgents, loadGlobalConfig } from '../config/loader.js'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..')
const CONFIG_PATH = resolve(ROOT, 'config', 'default.json')

function loadDefaultAgent(): string {
  try {
    if (existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      return cfg.defaultAgent ?? 'A'
    }
  } catch { /* ignore */ }
  return 'A'
}

function saveDefaultAgent(id: string): void {
  try {
    let cfg = { llm: { provider: 'openai', apiKey: '', model: 'gpt-4o' }, defaultAgent: 'A' }
    if (existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    }
    cfg.defaultAgent = id
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

export async function runCli(): Promise<void> {
  const program = new Command()

  program
    .name('purple')
    .description('Purple AI - 多 Agent 协作框架')
    .version('0.1.0')

  program
    .command('start', { isDefault: true })
    .description('Start Purple AI')
    .option('-a, --agent <id>', 'Agent to start with', loadDefaultAgent())
    .action(async (options) => {
      const defaultId = options.agent.toUpperCase()
      saveDefaultAgent(defaultId)

      const manager = new AgentManager(defaultId)
      await manager.startAgent(defaultId)

      const repl = new REPL(manager)
      await repl.run()
    })

  program
    .command('list')
    .description('List available agents')
    .action(() => {
      const agents = loadAgents()
      console.log('\nAvailable agents:')
      for (const a of agents) {
        console.log(`  ${a.id.padEnd(4)} ${a.name.padEnd(12)} ${a.role.padEnd(14)} :${a.port}`)
      }
      console.log()
    })

  program
    .command('help')
    .description('Show help')
    .action(() => program.help())

  program.parse(process.argv)
}
