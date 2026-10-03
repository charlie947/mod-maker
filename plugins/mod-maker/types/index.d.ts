export type Repeat = { text: string; keys: string[]; count: number; examples: string[]; offered: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mod-maker': { groups: Repeat[]; offer: Repeat | null }
  }
}
