import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import type { Tool } from './types.js'

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Path is relative to workspace.',
  schema: z.object({
    path: z.string(),
  }),

  async execute(params, ctx) {
    const filePath = resolve(ctx.workspace, params.path as string)
    if (!filePath.startsWith(ctx.workspace)) {
      return `[Error: path escapes workspace]`
    }
    try {
      const content = await readFile(filePath, 'utf-8')
      const rel = relative(ctx.workspace, filePath)
      return `--- ${rel} ---\n${content}`
    } catch (e: any) {
      return `[Error: ${e.message}]`
    }
  },
}
