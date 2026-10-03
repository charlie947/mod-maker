// Pure helpers: spot a tool call that sends a message to a person, and read who it goes to and what it says.

export type Outgoing = { channel: string; to: string[]; subject?: string; text: string; files: string[] }

// Splits a shell command into words, keeping quoted text whole.
export function words(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  let has = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has || cur) out.push(cur)
  return out
}

// Only as the command itself (start of a line or after ; && || | $( ), never as an argument to grep or cat.
const SEND_CLI = /(^|[;&|(\n])\s*(?:~\/bin\/|\S*\/)?(wa-send|slack-send)(?=\s|$)/

// A shell command that sends: wa-send <to> "<text>", with --image / --file attachments.
export function fromBash(command: string): Outgoing | null {
  const m = SEND_CLI.exec(command)
  if (!m) return null
  const tail = words(command.slice(m.index + m[0].length))
  if (tail.some(w => w === '--list' || w === '--dry-run' || w === '--help' || w === '-h')) return null
  const files: string[] = []
  const rest: string[] = []
  for (let i = 0; i < tail.length; i++) {
    const w = tail[i]
    if (w === '--image' || w === '--file') files.push(tail[++i] ?? '')
    else if (w === '--no-stagger') continue
    else if (/^[;&|]/.test(w)) break
    else rest.push(w)
  }
  if (rest.length === 0) return null
  const channel = m[2] === 'wa-send' ? 'WhatsApp' : 'Slack'
  return { channel, to: [rest[0]], text: rest.slice(1).join(' '), files }
}

// An MCP tool that sends: Gmail send/reply/forward, Slack send or schedule, any *send_message*.
// Drafts are left alone: a draft reaches no one.
const SEND_MCP = /(send|reply|forward|post_message|schedule_message)/i
export function fromMcp(tool: string, input: Record<string, any>): Outgoing | null {
  if (!tool.startsWith('mcp__')) return null
  const name = tool.split('__').pop() ?? ''
  if (/draft/i.test(name) || !SEND_MCP.test(name)) return null
  const server = tool.split('__')[1] ?? ''
  const channel = /gmail|mail/i.test(server + name) ? 'Email' : /slack/i.test(server + name) ? 'Slack' : /whatsapp/i.test(server + name) ? 'WhatsApp' : server.replace(/^claude_ai_/, '').replace(/_/g, ' ')
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : v ? String(v).split(/\s*,\s*/) : [])
  const to = [...list(input.to), ...list(input.cc).map(x => `${x} (cc)`), ...list(input.bcc).map(x => `${x} (bcc)`)]
  for (const k of ['channel_id', 'channel', 'chatId', 'recipient', 'user_id', 'thread_id', 'threadId', 'messageId', 'message_id']) {
    if (to.length === 0 && input[k]) to.push(k.includes('thread') || k.includes('message') ? `the thread ${input[k]}` : String(input[k]))
  }
  const text = String(input.body ?? input.text ?? input.message ?? input.content ?? input.htmlBody ?? '')
  const files = list(input.attachments ?? input.attachment)
  return { channel, to: to.length ? to : ['(no recipient given)'], subject: input.subject ? String(input.subject) : undefined, text, files }
}

export function outgoing(tool: string, input: Record<string, any>): Outgoing | null {
  if (tool === 'Bash') return fromBash(String(input.command ?? ''))
  return fromMcp(tool, input)
}

// The tool's own arguments: everything on the call but the engine's envelope fields.
export function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const { tool: _t, tool_use_id: _id, agentId: _a, ...args } = e
  return args
}
