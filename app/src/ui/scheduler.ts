import { getState } from './store.js'

let dirty = false
let scheduled = false
let commitFn: (() => void) | null = null
const FRAME_MS = 100

export function setCommitFn(fn: () => void): void {
  commitFn = fn
}

export function markDirty(): void {
  if (dirty) return
  dirty = true
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    scheduled = false
    if (!dirty) return
    dirty = false
    commitFn?.()
  }, FRAME_MS)
}
