// Pure helpers for the .env pane: read key names, mask values, check a pasted value, write it back.

export type EnvKey = { name: string; masked: string }

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2')

// Shows that a value is there and how long it is. No character of the value is ever shown.
export function maskValue(v: string): string {
  if (!v) return 'empty'
  return `hidden · ${v.length} chars`
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

// The variable names code reads, from the usual ways JavaScript, TypeScript, Python, Deno and
// shell scripts ask for them.
const READS: RegExp[] = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /os\.environ\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\]/g,
  /os\.(?:environ\.get|getenv)\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /Deno\.env\.get\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g,
]
const BUILT_IN = new Set(['NODE_ENV', 'HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TERM', 'CI', 'PORT', 'TZ', 'LANG'])

export function readsIn(code: string): string[] {
  const out = new Set<string>()
  for (const re of READS) for (const m of code.matchAll(re)) if (!BUILT_IN.has(m[1])) out.add(m[1])
  return [...out]
}

// Names the code reads that the .env file does not set: the ones that break at run time.
export function missingKeys(read: string[], set: string[]): string[] {
  const have = new Set(set)
  return [...new Set(read)].filter(n => !have.has(n)).sort()
}

export const CODE_FILE = /\.(m?[jt]sx?|cjs|py|sh)$/
