import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Message } from '../types.js'
import { PriorityQueue } from './queue.js'

export class Inbox {
  private queue: PriorityQueue
  private filePath: string

  constructor(filePath: string) {
    this.queue = new PriorityQueue()
    this.filePath = filePath
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) return
    try {
      const data = await readFile(this.filePath, 'utf-8')
      const messages: Message[] = JSON.parse(data)
      for (const msg of messages) {
        this.queue.enqueue(msg)
      }
    } catch {
      this.queue.clear()
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.filePath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.filePath, JSON.stringify(this.queue.toArray(), null, 2), 'utf-8')
  }

  async push(msg: Message): Promise<void> {
    this.queue.enqueue(msg)
    await this.save()
  }

  async pull(): Promise<Message | undefined> {
    const msg = this.queue.dequeue()
    if (msg) await this.save()
    return msg
  }

  peek(): Message | undefined {
    return this.queue.peek()
  }

  get length(): number {
    return this.queue.length
  }

  async markRead(msgId: string): Promise<void> {
    await this.save()
  }
}
