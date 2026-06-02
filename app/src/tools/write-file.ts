import { z } from 'zod'
import { writeFile, copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Tool } from './types.js'

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates directories if needed. Backs up existing file with .bak.',
  schema: z.object({
    path: z.string(),
    content: z.string(),
  }),

  async execute(params, ctx) {
    const filePath = resolve(ctx.workspace, params.path as string)
    if (!filePath.startsWith(ctx.workspace)) {
      return `[Error: path escapes workspace]`
    }
    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      // Backup existing file
      try {
        await access(filePath, constants.F_OK)
        await copyFile(filePath, filePath + '.bak')
      } catch { /* no existing file, no backup needed */ }

      await writeFile(filePath, params.content as string, 'utf-8')
      const rel = relative(ctx.workspace, filePath)
      return `[Written ${rel}]`
    } catch (e: any) {
      return `[Error: ${e.message}]`
    }
  },
}
