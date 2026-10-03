export type Shown = { path: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'show-it': { pending: string[]; lastShown: Shown | null }
  }
}
