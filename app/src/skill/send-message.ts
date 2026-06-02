import { z } from 'zod'
import type { Message } from '../types.js'
import { sendMessage as networkSend } from '../network/client.js'
import { findAgent } from '../config/loader.js'
import type { Skill, SkillContext } from './types.js'

export const sendMessageSkill: Skill = {
  name: 'send_message',
  description: 'Send a message to another agent. Target agent will be auto-started if not running.',
  schema: z.object({
    to: z.string(),
    content: z.string(),
    type: z.enum(['task', 'result', 'broadcast']).optional().default('task'),
    context_summary: z.string().optional(),
  }),
  async execute(params: Record<string, unknown>, ctx: SkillContext) {
    const to = params.to as string
    const content = params.content as string
    const msgType = (params.type as Message['type']) ?? 'task'
    const context_summary = params.context_summary as string | undefined

    const target = findAgent(to)
    if (!target) {
      return { success: false, error: `Unknown agent: ${to}` }
    }

    const runtime = ctx.runtime
    const from = runtime.profile.id

    const msg: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      from,
      to,
      type: msgType,
      content,
      context_summary,
    }

    let ok = await networkSend(target.port, msg)

    // Auto-start target agent if not running (without switching active chat)
    if (!ok && runtime.manager) {
      try {
        await runtime.manager.startAgent(to)
        ok = await networkSend(target.port, msg)
      } catch {
        // Failed to auto-start
      }
    }

    runtime.onTaskSent(to)
    return { success: ok, message: msg }
  },
}
