export type LoopStatus = 'open' | 'done' | 'dropped'
export type Loop = { id: number; text: string; status: LoopStatus; proof?: string }

declare module 'claude-code' {
  interface PluginState {
    'open-loops': { loops: Loop[]; nextId: number }
  }
}
