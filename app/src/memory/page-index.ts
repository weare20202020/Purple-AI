import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { resolve, relative, extname, basename, join } from 'node:path'
import process from 'node:process'

export interface PageEntry {
  path: string
  type: 'file' | 'dir'
  ext: string
  size: number
  modified: number
  description?: string
}

const INDEX_PATH = resolve(process.cwd(), 'data', 'page-index.json')
const EXCLUDE = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.backup'])
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yaml', '.yml', '.toml', '.css', '.html', '.env', '.gitignore', '.env.example'])

async function scanDir(dir: string, base: string): Promise<PageEntry[]> {
  const entries: PageEntry[] = []
  try {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      if (EXCLUDE.has(item.name)) continue
      const fullPath = join(dir, item.name)
      const relPath = relative(base, fullPath)
      if (item.isDirectory()) {
        entries.push({ path: relPath, type: 'dir', ext: '', size: 0, modified: 0 })
        const children = await scanDir(fullPath, base)
        entries.push(...children)
      } else {
        const s = await stat(fullPath)
        entries.push({
          path: relPath,
          type: 'file',
          ext: extname(item.name),
          size: s.size,
          modified: s.mtimeMs,
        })
      }
    }
  } catch { /* skip unreadable */ }
  return entries
}

export async function buildPageIndex(workspace: string): Promise<PageEntry[]> {
  const entries = await scanDir(workspace, workspace)
  entries.sort((a, b) => a.path.localeCompare(b.path))
  const dir = resolve(INDEX_PATH, '..')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(INDEX_PATH, JSON.stringify(entries, null, 2), 'utf-8')
  return entries
}

export async function loadPageIndex(): Promise<PageEntry[]> {
  if (!existsSync(INDEX_PATH)) return []
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8')
    return JSON.parse(raw) as PageEntry[]
  } catch { return [] }
}

export function formatPageIndexShort(entries: PageEntry[], maxEntries = 30): string {
  const files = entries.filter(e => e.type === 'file' && TEXT_EXTS.has(e.ext))
  const shown = files.slice(0, maxEntries)
  const lines = shown.map(e => {
    const desc = e.description ? `  # ${e.description}` : ''
    const size = e.size > 1024 ? ` (${(e.size / 1024).toFixed(1)}KB)` : ` (${e.size}B)`
    return `  ${e.path}${desc}${size}`
  })
  if (files.length > maxEntries) lines.push(`  ... and ${files.length - maxEntries} more files`)
  return lines.join('\n')
}

export function pageIndexAge(): number {
  if (!existsSync(INDEX_PATH)) return -1
  const s = statSync(INDEX_PATH)
  return Date.now() - s.mtimeMs
}
