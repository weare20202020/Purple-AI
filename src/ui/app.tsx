import { useState, useEffect, useMemo } from 'react'
import { render, Box, Text, useApp, useStdout, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { AgentManager } from '../agent/manager.js'
import { BANNER } from './banner.js'

const DEEP     = '#7B4FB5'
const GRADIENT = ['#6B3FA0','#7B4FB5','#8B5FC8','#9E70D6','#B283E3','#C499EE']
const LIGHT    = '#C4AFF0'
const TEXT     = '#FFB5C2'
const DIM      = '#6B5B7B'

const ALL_COMMANDS = [
  { cmd: '/talk <id>',          desc: 'Switch agent' },
  { cmd: '/agents',             desc: 'List agents' },
  { cmd: '/new',                desc: 'New session' },
  { cmd: '/new agent <n> <r>',  desc: 'Create & start a new agent' },
  { cmd: '/session [id]',       desc: 'List / switch session' },
  { cmd: '/default <id>',       desc: 'Set default agent' },
  { cmd: '/start <id>',         desc: 'Start agent' },
  { cmd: '/status',             desc: 'Session info' },
  { cmd: '/index',              desc: 'Rebuild file index' },
  { cmd: '/help',               desc: 'This help' },
  { cmd: '/quit',               desc: 'Exit' },
]

interface ChatMessage {
  id: number
  sender: string
  text: string
}

export function renderApp(manager: AgentManager): Promise<unknown> {
  const { waitUntilExit } = render(<PurpleApp manager={manager} />)
  return waitUntilExit()
}

let msgId = 0

function PurpleApp({ manager }: { manager: AgentManager }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [usage, setUsage] = useState(manager.getContextUsage())
  const [sessName, setSessName] = useState(manager.getSessionName())
  const [suggestionIndex, setSuggestionIndex] = useState(-1)
  const { exit } = useApp()
  const { stdout } = useStdout()
  const agent = manager.getActiveRuntime()!
  const W = (stdout.columns ?? 78) - 2

  const filteredCommands = useMemo(() => {
    if (!input.startsWith('/')) return []
    const prefix = input.toLowerCase()
    return ALL_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(prefix) || c.cmd.startsWith(prefix))
  }, [input])

  const showSuggestions = input.startsWith('/') && filteredCommands.length > 0

  useEffect(() => {
    if (!showSuggestions) setSuggestionIndex(-1)
  }, [showSuggestions])

  useEffect(() => {
    manager.setOutputCallback((agentId, text) => {
      if (agentId === manager.getActiveId()) {
        setMessages(prev => [...prev, { id: ++msgId, sender: agentId, text }])
        setUsage(manager.getContextUsage())
        setSessName(manager.getSessionName())
      }
    })
  }, [manager])

  useInput((_input, key) => {
    if (!showSuggestions) return

    if (key.upArrow) {
      setSuggestionIndex(prev => prev <= 0 ? filteredCommands.length - 1 : prev - 1)
      return
    }
    if (key.downArrow || key.tab) {
      setSuggestionIndex(prev => prev >= filteredCommands.length - 1 ? 0 : prev + 1)
      return
    }
    if (key.return) {
      if (suggestionIndex >= 0 && suggestionIndex < filteredCommands.length) {
        const picked = filteredCommands[suggestionIndex].cmd.split(' ')[0]
        setInput(picked + ' ')
        setSuggestionIndex(-1)
      }
      return
    }
    if (key.escape) {
      setSuggestionIndex(-1)
      return
    }
  })

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || loading) return
    setInput('')
    setLoading(true)

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed)
      setLoading(false)
      return
    }

    setMessages(prev => [...prev, { id: ++msgId, sender: '你', text: trimmed }])
    try {
      const response = await agent.processUserInput(trimmed)
      setMessages(prev => [...prev, { id: ++msgId, sender: agent.profile.name, text: response }])
      setUsage(manager.getContextUsage())
      setSessName(manager.getSessionName())
    } catch (e: any) {
      setMessages(prev => [...prev, { id: ++msgId, sender: '!', text: e.message ?? String(e) }])
    }
    setLoading(false)
  }

  const handleCommand = async (cmd: string) => {
    const parts = cmd.split(/\s+/)
    const command = parts[0].toLowerCase()
    const arg = parts.slice(1).join(' ')

    switch (command) {
      case '/quit':
      case '/exit':
        exit()
        return

      case '/talk': {
        if (!arg) { push('Usage: /talk <agent_id>'); return }
        try {
          const rt = await manager.switchAgent(arg.toUpperCase())
          push(`Switched to ${rt.profile.name}`)
        } catch { push(`Unknown: ${arg}`) }
        return
      }

      case '/agents':
        push(manager.getAllStatus().map(a =>
          `${a.id}  ${a.name}  ${a.role}  ${a.running ? 'running' : 'stopped'}${a.active ? '  <--' : ''}`
        ).join('\n'))
        return

      case '/new': {
        const parts = arg.split(/\s+/)
        const sub = parts[0]?.toLowerCase()

        if (sub === 'agent') {
          const agentName = parts[1]
          const agentRole = parts[2]
          const expertise = parts.slice(3).join(' ').split(',').map(s => s.trim()).filter(Boolean)
          if (!agentName || !agentRole) { push('Usage: /new agent <name> <role> [expertise,...]'); return }
          try {
            const rt = await manager.createAgent(agentName, agentRole, expertise.length > 0 ? expertise : [agentRole])
            push(`Created and started agent "${rt.profile.name}" (${rt.profile.id}) on port ${rt.profile.port}`)
            setUsage(manager.getContextUsage())
          } catch (e: any) { push(`Error: ${e.message}`) }
          return
        }

        await manager.createNewSession()
        const rt = manager.getActiveRuntime()
        push(`New session started — ${rt?.profile.name} is ready.`)
        setUsage(manager.getContextUsage())
        setSessName(manager.getSessionName())
        return
      }

      case '/session': {
        if (!arg) {
          const sessions = manager.listSessions()
          if (sessions.length === 0) { push('No saved sessions.'); return }
          const lines = sessions.map((s, i) => {
            const active = s.id === rt.sessionId ? '  <--' : ''
            return `${i + 1}  ${s.name}  ${s.messageCount} msgs  ${new Date(s.updatedAt).toLocaleString()}${active}`
          })
          push(lines.join('\n') + '\n/session <id> or /session <number> to switch')
        } else {
          const sessions = manager.listSessions()
          const idx = parseInt(arg, 10)
          let targetId = arg
          if (!isNaN(idx) && idx >= 1 && idx <= sessions.length) targetId = sessions[idx - 1].id
          const exists = sessions.find(s => s.id === targetId)
          if (!exists) { push(`Session not found: ${arg}`); return }
          await manager.switchToSession(targetId)
          push(`Switched to session "${exists.name}"`)
          setUsage(manager.getContextUsage())
          setSessName(manager.getSessionName())
        }
        return
      }

      case '/start': {
        if (!arg) { push('Usage: /start <agent_id>'); return }
        try {
          const rt = await manager.startAgent(arg.toUpperCase())
          push(`Started ${rt.profile.name}`)
        } catch { push(`Unknown: ${arg}`) }
        return
      }

      case '/default': {
        if (!arg) { push(`Default: ${manager.defaultId}`); return }
        const id = arg.toUpperCase()
        if (!manager.getAllStatus().find(a => a.id === id)) { push(`Unknown: ${id}`); return }
        manager.defaultId = id
        push(`Default set to ${id}`)
        return
      }

      case '/status':
        push(`Active: ${agent.profile.name} (${agent.profile.id})\nModel: ${manager.providerName}\nContext: ${usage.used} / ${usage.limit} (${usage.pct}%)`)
        return

      case '/index': {
        const rt = manager.getActiveRuntime()
        if (!rt) return
        try {
          const { buildPageIndex } = await import('../memory/page-index.js')
          const entries = await buildPageIndex(rt.workspace)
          push(`Indexed ${entries.length} files`)
        } catch (e: any) { push(`Error: ${e.message}`) }
        return
      }

      case '/help':
        push(ALL_COMMANDS.map(c => `${c.cmd.padEnd(18)} ${c.desc}`).join('\n'))
        return

      default:
        push(`Unknown: ${command}. Type /help`)
    }
  }

  const push = (text: string) => setMessages(prev => [...prev, { id: ++msgId, sender: '', text }])

  const rt = manager.getActiveRuntime()!
  const agentName = rt.profile.name

  const Sep = () => <Text color={DEEP}>{'─'.repeat(W)}</Text>

  const StatusLine = () => (
    <Text>
      <Text color={DEEP}>● </Text>
      <Text color={TEXT}>{manager.providerName}</Text>
      <Text color={DEEP}> │ </Text>
      <Text color={TEXT}>█ {usage.pct}%</Text>
    </Text>
  )

  const StartupPanel = () => (
    <Box borderStyle="round" borderColor={DEEP} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" alignItems="center" width={stdout.columns - 2}>
      <Box flexDirection="column" alignItems="center">
        {BANNER.map((line, i) => (
          <Text key={i} color={GRADIENT[i]}>{line}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={LIGHT} bold>Multi-Agent Framework  v0.1.0</Text>
      </Box>
      <Box borderStyle="single" borderColor={DEEP} paddingX={1} marginTop={1} flexDirection="column" width={64}>
        <Box><Text color={TEXT}><Text bold color={LIGHT}>Agent</Text>:</Text></Box>
        {manager.getAllStatus().map(a => (
          <Box key={a.id}>
            <Text color={TEXT}>
              {a.active ? <Text color={LIGHT}>{'>'}</Text> : <Text>{' '}</Text>}
              {' '}
              {a.running ? <Text color={DEEP}>{'●'}</Text> : <Text>{'○'}</Text>}
              {' '}
              <Text color={TEXT}>{a.name}</Text>
              {`  ${a.role}`}
            </Text>
          </Box>
        ))}
        <Box marginTop={1}><Text color={TEXT}><Text bold color={LIGHT}>Skill</Text>: send_message</Text></Box>
        <Box><Text color={TEXT}><Text bold color={LIGHT}>Model</Text>: {manager.providerName}</Text></Box>
        <Box><Text color={TEXT}>/help  for commands</Text></Box>
      </Box>
    </Box>
  )

  const SuggestionBox = () => {
    if (!showSuggestions) return null
    return (
      <Box flexDirection="column" marginTop={0} paddingLeft={3}>
        {filteredCommands.map((c, i) => {
          const isHighlighted = i === suggestionIndex
          return (
            <Box key={c.cmd} height={1}>
              <Text>
                {isHighlighted ? <Text color={LIGHT}>{'▸ '}</Text> : <Text color={DIM}>{'  '}</Text>}
                <Text color={isHighlighted ? LIGHT : DIM}>{c.cmd}</Text>
                <Text color={DIM}>{'  '}{c.desc}</Text>
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box paddingLeft={1} paddingRight={1} marginTop={1}>
        <StartupPanel />
      </Box>

      <Box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
        {messages.map((msg) => {
          const isUser = msg.sender === '你'
          const isAgent = msg.sender && msg.sender !== '你'
          const borderClr = isUser ? LIGHT : DEEP
          const label = isUser ? 'User' : msg.sender

          return (
            <Box key={msg.id} flexDirection="column" marginTop={1}>
              <Box borderStyle="round" borderColor={borderClr} paddingX={1}>
                <Text color={TEXT}>
                  <Text bold color={borderClr}>{label}</Text>
                  <Text>: </Text>
                  <Text color={TEXT}>{msg.text}</Text>
                </Text>
              </Box>
            </Box>
          )
        })}

        {loading ? (
          <Box marginTop={1}>
            <Text color={DEEP}>Thinking...</Text>
          </Box>
        ) : null}
      </Box>

      <Box flexDirection="column" paddingLeft={1} paddingRight={1} marginBottom={1}>
        <Box><Text bold color={LIGHT}>{agentName} ❯ </Text><Text color={TEXT}><TextInput value={input} onChange={setInput} onSubmit={handleSubmit} /></Text></Box>
        <SuggestionBox />
        <Sep />
        <StatusLine />
      </Box>
    </Box>
  )
}
