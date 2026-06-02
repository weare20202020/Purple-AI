import type { AgentManager } from '../agent/manager.js'
import { renderApp } from '../ui/app.js'
import { ClassicREPL } from './classic.js'

export class REPL {
  private manager: AgentManager

  constructor(manager: AgentManager) {
    this.manager = manager
  }

  async run(): Promise<void> {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      await renderApp(this.manager)
    } else {
      const repl = new ClassicREPL(this.manager)
      await repl.run()
    }
  }

  stop(): void {
    process.exit(0)
  }
}
