import { z } from 'zod'
import type { AgentRuntime } from '../agent/runtime.js'

export interface SkillContext {
  runtime: AgentRuntime
}

export interface Skill {
  name: string
  description: string
  schema: z.ZodObject<any>
  execute(params: Record<string, unknown>, ctx: SkillContext): Promise<unknown>
}
