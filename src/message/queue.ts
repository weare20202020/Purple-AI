import type { Message } from '../types.js'

const PRIORITY_MAP: Record<string, number> = {
  user: 0,
  task: 1,
  result: 2,
  summary: 3,
  question: 4,
}

export class PriorityQueue {
  private queue: Message[] = []

  enqueue(msg: Message): void {
    const priority = msg.from === 'USER' ? PRIORITY_MAP.user : (PRIORITY_MAP[msg.type] ?? 5)
    let i = 0
    while (i < this.queue.length && priority >= (this.queue[i].from === 'USER' ? 0 : (PRIORITY_MAP[this.queue[i].type] ?? 5))) {
      i++
    }
    this.queue.splice(i, 0, msg)
  }

  dequeue(): Message | undefined {
    return this.queue.shift()
  }

  peek(): Message | undefined {
    return this.queue[0]
  }

  get length(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue = []
  }

  toArray(): Message[] {
    return [...this.queue]
  }
}
