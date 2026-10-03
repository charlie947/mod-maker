// What counts as a secret file, which commands would print one, and how keys are masked.

const SAFE_ENV = /\.env\.(example|sample|template|dist)$/i
const SECRET_FILE =
  /(^|\/)(\.env(\.[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|key|p12|pfx|keystore|jks)|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service[-_]account[^/]*\.json)$/i

export function isSecretFile(path: string): boolean {
  const p = path.replace(/\/+$/, '')
  return SECRET_FILE.test(p) && !SAFE_ENV.test(p)
}

const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'grep', 'rg', 'awk', 'sed', 'strings', 'xxd', 'od', 'hexdump', 'base64', 'source', '.', 'nl', 'cut', 'sort', 'jq', 'yq', 'diff', 'type'])

// Returns why a shell command would print a secret, or null when it would not.
export function secretCommand(cmd: string): string | null {
  const parts = cmd.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const w = part.split(/\s+/).map(x => x.replace(/^['"]|['"]$/g, ''))
    const head = (w[0] ?? '').split('/').pop() ?? ''
    if ((head === 'env' || head === 'printenv' || head === 'export' || head === 'set') && w.length === 1) {
      return `\`${head}\` prints every environment variable, keys included`
    }
    const file = w.slice(1).find(a => isSecretFile(a.replace(/^[<>]+/, '')))
    if (READERS.has(head) && file) return `\`${head}\` would print ${file}`
    const redirected = part.match(/<\s*(\S+)/)?.[1]
    if (redirected && isSecretFile(redirected)) return `the command reads ${redirected}`
  }
  return null
}

const KEY_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // Anthropic, OpenAI
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}/g, // Stripe
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]
const ASSIGNED = /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"']{8,})\3/gi

export function maskKeys(text: string): { text: string; count: number } {
  let count = 0
  let out = text
  for (const re of KEY_PATTERNS) {
    out = out.replace(re, m => {
      count++
      return m.startsWith('-----') ? '[private key masked by secrets-guard]' : `${m.slice(0, 4)}…[masked]`
    })
  }
  out = out.replace(ASSIGNED, (m, name, sep, q, value) => {
    if (value.includes('[masked]')) return m
    count++
    return `${name}${sep}${q}[masked]${q}`
  })
  return { text: out, count }
}
