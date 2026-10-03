// Picks the asks out of one prompt. Cheap and local: the model fixes misses
// through add_loop, so this only has to catch the obvious ones.

const ASK_START =
  /^(please |pls |can you|could you|can we|could we|will you|would you|make sure|let'?s |send|show|add|fix|build|put|push|check|update|tell|bring|give|get|load|schedule|delete|remove|clean|create|make|draft|write|reply|post|publish|upload|share|run|render|go ahead|do |finalise|finish|save|bank|review|qa|analyse|research|look (at|into)|find|move|set up|book|fill|count|list|compare|explain|summari[sz]e|rename|test|try|turn|change|convert|translate|shorten|cut|trim|tidy|rewrite|redo|swap|replace|include|keep|drop|pull|grab|open|record|edit|polish|merge|split|rerun|re-run|retry|resend|confirm|verify|measure|use|need you|i need you|i want you|we need to)/i

const ASK_ANYWHERE = /\b(make sure|please|can you|could you|can we|need you to|want you to)\b/i

// Bare approvals and pings are replies, not asks.
const NOT_AN_ASK =
  /^(go|send|yes|no|ok|okay|done|great|perfect|eta\??|allow|connected|open|in|sure|yep|nice|amazing|how'?s it going\??)[.!? ]*$/i

// Rules and limits ("Do not read files outside this folder", "Preserve .env", "Work only in X")
// shape how the work is done. They are not tasks to finish, so they are not loops.
// "Don't forget to send…" is still an ask.
const CONSTRAINT =
  /^(do not|don'?t|never|avoid|no |not |without |stay |work only|preserve|leave .+ (alone|as is|untouched)|keep .+ (unchanged|intact|as is|private))/i
const STILL_AN_ASK = /^(do not|don'?t|never) forget\b/i

const MAX_PROMPT = 4000 // longer prompts are pasted transcripts or scheduled jobs
const MAX_ASKS = 8

export function extractAsks(raw: string): string[] {
  if (!raw || raw.length > MAX_PROMPT) return []
  const text = raw
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ') // drop tagged pastes and reminders
    .replace(/\[(Image|Pasted text)[^\]]*\]/gi, ' ')
    .replace(/(^|\s)\/[a-z][\w:-]*(?=\s|$)/gi, ' ') // drop /plan, /close
    .replace(/(file:\/\/|https?:\/\/)\S+/g, '(link)')
  // A line that starts a numbered or bulleted list is an ask whatever its verb.
  const sentences = text
    .split(/\n+/)
    .flatMap(line => {
      const marker = /^\s*(\d+[.)]|[-*•])\s+/
      const listed = marker.test(line)
      return line.replace(marker, '').split(/(?<=[.?!])\s+/).map((s, i) => ({ s: s.replace(/^[\s\-*•\d.)]+/, '').trim(), listed: listed && i === 0 }))
    })
    .filter(x => x.s)

  const asks: string[] = []
  for (const { s, listed } of sentences) {
    if (s.length < 6 || s.length > 300) continue
    if (NOT_AN_ASK.test(s)) continue
    // "And send me…", "Also add…": the joining word hides the verb, so test without it.
    const bare = s.replace(/^(and|also|then|plus|so|oh and|and also)[, ]+/i, '')
    if (CONSTRAINT.test(bare) && !STILL_AN_ASK.test(bare)) continue
    if (listed || s.endsWith('?') || STILL_AN_ASK.test(bare) || ASK_START.test(bare) || ASK_ANYWHERE.test(s)) asks.push(s)
    if (asks.length >= MAX_ASKS) break
  }
  return asks
}
