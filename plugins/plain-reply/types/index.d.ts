export type Grade = { words: number; longest: number; jargon: string[]; over: boolean; reasons: string[] }

declare module 'claude-code' {
  interface PluginState {
    'plain-reply': { grade: Grade | null }
  }
}
