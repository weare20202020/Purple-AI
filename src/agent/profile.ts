import type { AgentProfile } from '../types.js'

export function createDefaultConfig(id: string, port: number): { profile: AgentProfile; dataDir: string } {
  return {
    profile: {
      id,
      name: id,
      expertise: [],
      role: 'member',
      port,
    },
    dataDir: `data/${id}`,
  }
}

export function loadConfig(configPath: string): { profile: AgentProfile; dataDir: string } {
  const { existsSync } = require('node:fs')
  const { readFileSync } = require('node:fs')

  if (existsSync(configPath)) {
    const data = readFileSync(configPath, 'utf-8')
    return JSON.parse(data)
  }

  return createDefaultConfig('agent', 3000)
}
