export type EnvRequest = {
  key: string
  why: string
  where: string[]
  link?: string
  format?: string
  minLength: number
  file: string
}

export type EnvKeyRow = { name: string; masked: string }

declare module 'claude-code' {
  interface PluginState {
    'secrets-guard': { requests: EnvRequest[]; keys: EnvKeyRow[]; file: string; error: string; missing: string[] }
  }
}
