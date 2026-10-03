export type HeldState = 'held' | 'kept' | 'sending' | 'sent' | 'failed'

export type Held = {
  id: string
  tool: string
  input: Record<string, unknown>
  channel: string
  to: string[]
  subject?: string
  text: string
  files: string[]
  heldMs: number
  state: HeldState
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    outbox: { held: Held[] }
  }
}
