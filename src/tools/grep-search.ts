import { z } from 'zod'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import type { Tool } from './types.js'

export const grepSearchTool: Tool = {
  name: 'grep_search',
  description: 'Search for a regex pattern in files within the workspace.',
  schema: z.object({
    pattern: z.string(),
    path: z.string().optional(),
  }),

  async execute(params, ctx) {
    const searchPath = params.path
      ? resolve(ctx.workspace, params.path as string)
      : ctx.workspace
    if (!searchPath.startsWith(ctx.workspace)) {
      return `[Error: path escapes workspace]`
    }
    try {
      const regex = new RegExp(params.pattern as string, 'gi')
      const results: string[] = []
      await search(searchPath, regex, ctx.workspace, results)
      if (results.length === 0) return `[No matches for: ${params.pattern}]`
      return results.join('\n')
    } catch (e: any) {
      return `[Error: ${e.message}]`
    }
  },
}

async function search(dir: string, regex: RegExp, base: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (results.length >= 50) return
      await search(full, regex, base, results)
    } else {
      try {
        const s = await stat(full)
        if (s.size > 1024 * 1024) continue // skip files > 1MB
        const content = await readFile(full, 'utf-8')
        if (regex.test(content)) {
          const rel = relative(base, full)
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`)
              if (results.length >= 50) return
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  }
}
