import { z } from 'zod'
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { execSync } from 'node:child_process'
import type { Tool } from './types.js'

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by finding and replacing text. Always prefer this over write_file for partial changes.',
  schema: z.object({
    path: z.string(),
    oldStr: z.string(),
    newStr: z.string(),
    commit: z.boolean().optional(),
  }),

  async execute(params, ctx) {
    const filePath = resolve(ctx.workspace, params.path as string)
    if (!filePath.startsWith(ctx.workspace)) return `[Error: path escapes workspace]`

    if (!existsSync(filePath)) return `[Error: file not found: ${params.path}]`

    const oldStr = params.oldStr as string
    const newStr = params.newStr as string

    const content = readFileSync(filePath, 'utf-8')
    const idx = content.indexOf(oldStr)
    if (idx === -1) return `[Error: oldStr not found in ${params.path}]`

    // backup
    const backupPath = filePath + '.backup'
    copyFileSync(filePath, backupPath)

    try {
      const newContent = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length)
      writeFileSync(filePath, newContent, 'utf-8')

      // git commit if requested and inside a git repo
      if (params.commit) {
        try {
          const rel = relative(ctx.workspace, filePath)
          execSync(`git add "${rel}"`, { cwd: ctx.workspace, stdio: 'pipe' })
          execSync(`git commit -m "edit: ${rel}"`, { cwd: ctx.workspace, stdio: 'pipe' })
        } catch { /* not a git repo or git not available */ }
      }

      // clean up backup on success
      try { unlinkSync(backupPath) } catch { /* ignore */ }

      const linesChanged = oldStr.split('\n').length
      return `[Edited ${params.path}: ${idx}-${idx + oldStr.length} (${linesChanged} lines)]`
    } catch (e: any) {
      // rollback
      if (existsSync(backupPath)) {
        copyFileSync(backupPath, filePath)
        try { unlinkSync(backupPath) } catch { /* ignore */ }
      }
      return `[Edit failed (rolled back): ${e.message}]`
    }
  },
}
