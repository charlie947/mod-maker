export type State = 'running' | 'done' | 'needs'
export type Card = {
  id: string; place: string; purpose: string; now: string; updatedMs: number
  state?: State; startMs?: number; endMs?: number; waitingFor?: string
}

declare module 'claude-code' {
  interface PluginState {
    'sessions-band': { others: Card[]; isHidden: boolean; nowMs: number }
  }
}
