import type { Message } from '../types.js'

export async function sendMessage(targetPort: number, msg: Message): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${targetPort}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
    return response.ok
  } catch {
    return false
  }
}
