import type { LLMProvider, LLMMessage, ToolDef, LLMResponse, ToolCall } from './types.js'

const ANTHROPIC_VERSION = '2023-06-01'

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'

  async generate(messages: LLMMessage[], apiKey: string, model: string, tools?: ToolDef[]): Promise<LLMResponse> {
    // Convert internal message format to Anthropic format
    const systemMsg = messages.find(m => m.role === 'system')
    const msgs = messages.filter(m => m.role !== 'system').map(m => this.toAnthropic(m))
    const body: Record<string, unknown> = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: msgs,
    }
    if (systemMsg?.content) {
      body.system = systemMsg.content
    }
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }))
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Anthropic API error ${res.status}: ${text}`)
    }
    const data: any = await res.json()
    return this.fromAnthropic(data)
  }

  private toAnthropic(msg: LLMMessage): any {
    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id ?? '',
          content: msg.content ?? '',
        }],
      }
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: any[] = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      for (const tc of msg.tool_calls) {
        let input: any = {}
        try { input = JSON.parse(tc.arguments) } catch { input = { _raw: tc.arguments } }
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
      }
      return { role: 'assistant', content }
    }
    // user / assistant with text
    return { role: msg.role, content: msg.content ?? '' }
  }

  private fromAnthropic(data: any): LLMResponse {
    let content: string | null = null
    const toolCalls: ToolCall[] = []
    for (const block of data.content || []) {
      if (block.type === 'text') {
        content = (content ?? '') + block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        })
      }
    }
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }
}
