// Pure helpers for the .env pane: read key names, mask values, check a pasted value, write it back.

export type EnvKey = { name: string; masked: string }

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

// Shows that a value is there and which one it is, never the value: the last 4 characters
// only when the value is long enough that 4 characters give nothing away.
export function maskValue(v: string): string {
  if (!v) return '(empty)'
  return v.length >= 16 ? `●●●●${v.slice(-4)}` : '●●●●●●●●'
}

export function listKeys(text: string): EnvKey[] {
  const out: EnvKey[] = []
  for (const line of text.split('\n')) {
    const m = line.match(LINE)
    if (m) out.push({ name: m[1], masked: maskValue(unquote(m[2])) })
  }
  return out
}

// Sets one key, replacing its line if it is there, adding it at the end if not.
export function setKey(text: string, name: string, value: string): string {
  const v = /[\s#"'$]/.test(value) ? `"${value.replace(/(["\\$])/g, '\\$1')}"` : value
  const lines = text.split('\n')
  const i = lines.findIndex(l => l.match(LINE)?.[1] === name)
  if (i >= 0) lines[i] = `${name}=${v}`
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push(`${name}=${v}`, '')
  }
  return lines.join('\n')
}

export const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// Returns why a pasted value is wrong, or null when it looks right.
export function checkValue(value: string, minLength = 8): string | null {
  if (!value.trim()) return 'Nothing was pasted.'
  if (/\n/.test(value)) return 'The value has a line break in it. Paste one line.'
  if (value.trim().length < minLength) return `That is ${value.trim().length} characters. This key is at least ${minLength}.`
  return null
}
