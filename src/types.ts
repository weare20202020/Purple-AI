export interface Message {
  id: string
  timestamp: string
  from: string
  to: string
  type: 'task' | 'result' | 'question' | 'summary'
  content: string
  context_summary?: string
  task_id?: string
  reply_to?: string
}

export interface AgentProfile {
  id: string
  name: string
  expertise: string[]
  role: string
  port: number
}
