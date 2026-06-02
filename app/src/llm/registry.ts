import type { LLMProvider } from './types.js'

const providers = new Map<string, LLMProvider>()

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, provider)
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name)
}
