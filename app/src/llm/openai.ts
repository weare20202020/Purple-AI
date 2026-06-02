import type { LLMProvider, LLMMessage, ToolDef, LLMResponse, ToolCall } from './types.js'

function toApiMessages(messages: LLMMessage[]): Record<string, unknown>[] {
  return messages.map(m => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content ?? null }
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
    if (m.tool_calls) {
      msg.tool_calls = m.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }))
    }
    return msg
  })
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai'

  async generate(messages: LLMMessage[], apiKey: string, model: string, tools?: ToolDef[]): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: model || 'gpt-4o',
      messages: toApiMessages(messages),
    }
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${text}`)
    }
    const data: any = await res.json()
    const msg = data.choices[0].message
    const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }))
    return {
      content: msg.content ?? null,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
    }
  }
}
