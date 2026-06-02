export interface UIState {
  messages: { id: number; sender: string; text: string }[]
  loading: boolean
  workingIds: string[]
  usage: { used: number; limit: number; pct: number }
  sessName: string
}

let state: UIState = {
  messages: [],
  loading: false,
  workingIds: [],
  usage: { used: 0, limit: 128000, pct: 0 },
  sessName: '',
}

const listeners = new Set<() => void>()

export function getState(): UIState {
  return state
}

export function updateState(partial: Partial<UIState>): UIState {
  state = { ...state, ...partial }
  listeners.forEach(fn => fn())
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
