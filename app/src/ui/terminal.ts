let registered = false

function cleanup(): void {
  try { process.stdin.setRawMode(false) } catch {}
  process.stdin.pause()
  process.stdout.write('\x1b[?25h')
  process.stdout.write('\x1b[0m')
}

export function setupTerminal(): void {
  if (registered) return
  registered = true

  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
  process.on('exit', cleanup)

  process.on('uncaughtException', (err) => {
    cleanup()
    console.error(err)
    process.exit(1)
  })
}
