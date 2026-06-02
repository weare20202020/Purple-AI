import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface Experience {
  id: string
  timestamp: string
  goal: string
  taskType: string
  summary: string
  keyDecisions: string[]
  findings: string
  success: boolean
  tags: string[]
}

function expPath(agentId: string): string {
  return resolve(process.cwd(), 'data', 'experiences', `${agentId}.json`)
}

export async function loadExperiences(agentId: string): Promise<Experience[]> {
  const fp = expPath(agentId)
  if (!existsSync(fp)) return []
  try {
    const raw = await readFile(fp, 'utf-8')
    return JSON.parse(raw) as Experience[]
  } catch { return [] }
}

export async function saveExperience(agentId: string, exp: Experience): Promise<void> {
  const fp = expPath(agentId)
  const dir = resolve(fp, '..')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const all = await loadExperiences(agentId)
  all.push(exp)
  await writeFile(fp, JSON.stringify(all, null, 2), 'utf-8')
}

export function computeRelevance(query: string, exp: Experience): number {
  const text = `${exp.goal} ${exp.summary} ${exp.findings} ${exp.tags.join(' ')}`.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (words.length === 0) return 0
  let matches = 0
  for (const w of words) {
    if (text.includes(w)) matches++
  }
  return matches / words.length
}

export async function retrieveRelevant(agentId: string, query: string, topK = 3): Promise<Experience[]> {
  const all = await loadExperiences(agentId)
  const scored = all.map(e => ({ exp: e, score: computeRelevance(query, e) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).filter(x => x.score > 0).map(x => x.exp)
}

export function formatExperiences(exps: Experience[]): string {
  if (exps.length === 0) return ''
  return exps.map((e, i) => {
    return `[Past Experience ${i + 1}]
Goal: ${e.goal}
Type: ${e.taskType}
Summary: ${e.summary}
Key Decisions: ${e.keyDecisions.join(', ')}
Findings: ${e.findings}
Success: ${e.success}
Tags: ${e.tags.join(', ')}`
  }).join('\n\n')
}
