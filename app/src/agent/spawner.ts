import { fork, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { findAgent } from '../config/loader.js'

const children = new Map<string, ChildProcess>()

export function spawnAgent(id: string): boolean {
  if (children.has(id)) return true

  const entry = findAgent(id)
  if (!entry) return false

  const script = resolve(import.meta.dirname ?? process.cwd(), '..', 'index.ts')

  const child = fork(script, ['start', '--agent', id, '--port', String(entry.port), '--daemon'],
    {
      stdio: 'pipe',
      env: {
        ...process.env as Record<string, string>,
      },
      execArgv: ['--import', 'tsx'],
    }
  )

  child.on('exit', (code) => {
    children.delete(id)
  })

  children.set(id, child)
  return true
}

export function stopAgent(id: string): void {
  const child = children.get(id)
  if (child) {
    child.kill()
    children.delete(id)
  }
}

export function stopAllAgents(): void {
  for (const [id, child] of children) {
    child.kill()
  }
  children.clear()
}
