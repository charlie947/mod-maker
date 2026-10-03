// Picks the asks out of one prompt. Cheap and local: the model fixes misses
// through add_loop, so this only has to catch the obvious ones.

const ASK_START =
  /^(please |pls |can you|could you|can we|could we|will you|would you|make sure|let'?s |send|show|add|fix|build|put|push|check|update|tell|bring|give|get|load|schedule|delete|remove|clean|create|make|draft|write|reply|post|publish|upload|share|run|render|go ahead|do |finalise|finish|save|bank|review|qa|analyse|research|look (at|into)|find|move|set up|book|fill|need you|i need you|i want you|we need to)/i

const ASK_ANYWHERE = /\b(make sure|please|can you|could you|can we|need you to|want you to)\b/i

// Bare approvals and pings are replies, not asks.
const NOT_AN_ASK =
  /^(go|send|yes|no|ok|okay|done|great|perfect|eta\??|allow|connected|open|in|sure|yep|nice|amazing|how'?s it going\??)[.!? ]*$/i

const MAX_PROMPT = 4000 // longer prompts are pasted transcripts or scheduled jobs
const MAX_ASKS = 8

export function extractAsks(raw: string): string[] {
  if (!raw || raw.length > MAX_PROMPT) return []
  const text = raw
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ') // drop tagged pastes and reminders
    .replace(/\[(Image|Pasted text)[^\]]*\]/gi, ' ')
    .replace(/(^|\s)\/[a-z][\w:-]*(?=\s|$)/gi, ' ') // drop /plan, /close
    .replace(/(file:\/\/|https?:\/\/)\S+/g, '(link)')
  const sentences = text
    .split(/(?<=[.?!])\s+|\n+/)
    .map(s => s.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter(Boolean)

  const asks: string[] = []
  for (const s of sentences) {
    if (s.length < 6 || s.length > 300) continue
    if (NOT_AN_ASK.test(s)) continue
    if (s.endsWith('?') || ASK_START.test(s) || ASK_ANYWHERE.test(s)) asks.push(s)
    if (asks.length >= MAX_ASKS) break
  }
  return asks
}
