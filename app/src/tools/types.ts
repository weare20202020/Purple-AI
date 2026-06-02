import { z } from 'zod'
import type { AgentRuntime } from '../agent/runtime.js'

export interface ToolContext {
  workspace: string
  runtime: AgentRuntime
}

export interface Tool {
  name: string
  description: string
  schema: z.ZodObject<any>
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<string>
}
