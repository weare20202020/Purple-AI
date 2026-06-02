import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

interface MemoryEntry {
  timestamp: string
  summary: string
  type: 'experience' | 'context' | 'skill'
}

export class AgentMemory {
  private filePath: string
  private entries: MemoryEntry[] = []

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'memory.json')
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    if (existsSync(this.filePath)) {
      try {
        const data = await readFile(this.filePath, 'utf-8')
        this.entries = JSON.parse(data)
      } catch {
        this.entries = []
      }
    }
  }

  async add(entry: Omit<MemoryEntry, 'timestamp'>): Promise<void> {
    this.entries.push({ ...entry, timestamp: new Date().toISOString() })
    await writeFile(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8')
  }

  getRecent(n: number): MemoryEntry[] {
    return this.entries.slice(-n)
  }

  getAll(): MemoryEntry[] {
    return [...this.entries]
  }
}
