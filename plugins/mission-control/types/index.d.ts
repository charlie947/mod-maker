export type Step = { label: string; status: 'todo' | 'now' | 'done' }
export type Ask = { id: number; text: string; done: boolean; proof?: string }
export type Mission = {
  steps: Step[]
  feed: string[]
  asks: Ask[]
  nextAsk: number
  startedMs: number
  nowMs: number
  running: boolean
  doneBanner: string
  /** Set while Claude waits for the user to allow a tool; cleared when the work goes on. */
  waiting?: string
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': { mission: Mission; plainRows: boolean }
  }
}
