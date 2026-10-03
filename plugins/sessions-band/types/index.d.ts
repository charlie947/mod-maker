export type Card = { id: string; place: string; purpose: string; now: string; updatedMs: number }

declare module 'claude-code' {
  interface PluginState {
    'sessions-band': { others: Card[]; isHidden: boolean }
  }
}
