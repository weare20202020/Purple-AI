export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface LLMMessage {
  role: Role
  content: string | null
  reasoning_content?: string | null
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface LLMResponse {
  content: string | null
  reasoning_content?: string | null
  toolCalls?: ToolCall[]
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMProvider {
  readonly name: string
  generate(
    messages: LLMMessage[],
    apiKey: string,
    model: string,
    tools?: ToolDef[]
  ): Promise<LLMResponse>
}
