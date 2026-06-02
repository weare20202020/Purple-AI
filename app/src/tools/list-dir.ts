import { z } from 'zod'
import { readdir, stat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import type { Tool } from './types.js'

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List files and directories. Returns indented tree.',
  schema: z.object({
    path: z.string(),
    depth: z.number().optional().default(1),
  }),

  async execute(params, ctx) {
    const dirPath = resolve(ctx.workspace, params.path as string)
    if (!dirPath.startsWith(ctx.workspace)) {
      return `[Error: path escapes workspace]`
    }
    try {
      const depth = (params.depth as number) ?? 1
      const lines: string[] = []
      await walk(dirPath, ctx.workspace, 0, depth, lines)
      return lines.join('\n')
    } catch (e: any) {
      return `[Error: ${e.message}]`
    }
  },
}

async function walk(dir: string, base: string, level: number, maxDepth: number, lines: string[]): Promise<void> {
  if (level > maxDepth) return
  const prefix = '  '.repeat(level)
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`)
      await walk(full, base, level + 1, maxDepth, lines)
    } else {
      const s = await stat(full)
      lines.push(`${prefix}${entry.name}  (${s.size}B)`)
    }
  }
}
