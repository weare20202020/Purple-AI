import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Message } from '../types.js'

export class MessageServer {
  private server
  private onMessage: (msg: Message) => Promise<void>

  constructor(port: number, onMessage: (msg: Message) => Promise<void>) {
    this.onMessage = onMessage
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url === '/receive') {
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', async () => {
          try {
            const msg: Message = JSON.parse(body)
            await this.onMessage(msg)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'ok' }))
          } catch {
            res.writeHead(400)
            res.end(JSON.stringify({ error: 'invalid message' }))
          }
        })
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    this.server.on('error', (err: Error) => {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'EADDRINUSE') {
        console.error(`\x1b[38;2;196;175;240mPort ${port} already in use — Purple is probably already running in another terminal.\x1b[0m`)
        process.exit(1)
      }
    })
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, '127.0.0.1', () => {
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }
}
