import { z } from 'zod'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Tool } from './types.js'

export const runCommandTool: Tool = {
  name: 'run_command',
  description: 'Execute a shell command. Use with caution. High-risk operations will prompt for confirmation.',
  schema: z.object({
    command: z.string(),
    cwd: z.string().optional(),
  }),

  async execute(params, ctx) {
    const cmd = params.command as string
    const cmdCwd = params.cwd
      ? resolve(ctx.workspace, params.cwd as string)
      : ctx.workspace

    if (!cmdCwd.startsWith(ctx.workspace)) {
      return `[Error: cwd escapes workspace]`
    }

    // Interactive confirmation via console
    process.stdout.write(`\n  \x1b[38;2;196;175;240m[!!]\x1b[0m Run: \x1b[38;2;255;181;194m${cmd}\x1b[0m\n  \x1b[38;2;123;79;181mConfirm? [y/N]\x1b[0m `)

    const confirmed = await new Promise<boolean>((resolve) => {
      const stdin = process.stdin
      const onData = (chunk: Buffer) => {
        const input = chunk.toString().trim().toLowerCase()
        stdin.removeListener('data', onData)
        stdin.setRawMode?.(false)
        resolve(input === 'y' || input === 'yes')
      }
      stdin.resume()
      stdin.on('data', onData)
    })

    if (!confirmed) {
      return `[Command cancelled by user]`
    }

    try {
      const output = execSync(cmd, {
        cwd: cmdCwd,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      })
      return output.trim() || '[Command completed with no output]'
    } catch (e: any) {
      return `[Command error: ${e.message}]`
    }
  },
}
