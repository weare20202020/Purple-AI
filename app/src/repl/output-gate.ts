import { Writable } from 'node:stream'

export class OutputGate {
  private stream: Writable

  constructor(stream: Writable = process.stdout) {
    this.stream = stream
  }

  write(text: string): void {
    this.stream.write(text)
  }

  close(): void {
    this.stream.end()
  }
}

export const outputGate = new OutputGate()
