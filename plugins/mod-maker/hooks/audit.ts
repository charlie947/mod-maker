import { extractAsks } from './extract'

// /mod-audit: reads the prompts you typed (Claude Code keeps them in ~/.claude/history.jsonl),
// takes your last N sessions, and ranks the things you ask again and again. Every count is
// a count of real prompts. Nothing leaves your machine.

export type Entry = { text: string; ts: number; session: string }
export type Habit = { n: number; phrase: string; count: number; sessions: number; examples: string[] }

export function parseHistory(jsonl: string): Entry[] {
  const out: Entry[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      const text = String(d.display ?? '').trim()
      if (!text || text.startsWith('/')) continue // slash commands are not asks
      out.push({ text, ts: Number(d.timestamp) || 0, session: String(d.sessionId ?? `${d.project ?? ''}:${new Date(Number(d.timestamp) || 0).toISOString().slice(0, 10)}`) })
    } catch {
      // a half-written last line: skip it
    }
  }
  return out
}

export function lastSessions(entries: Entry[], n: number): Entry[] {
  const latest = new Map<string, number>()
  for (const e of entries) latest.set(e.session, Math.max(latest.get(e.session) ?? 0, e.ts))
  const keep = new Set([...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([s]) => s))
  return entries.filter(e => keep.has(e.session))
}

const STOP = new Set(
  ('a an the and or but so to of in on at for with from by as is are was were be been it its this that these those i me my we our you your ' +
    'can could would will should do does did please pls just also then now there here what which who how why when where if not no yes ' +
    'have has had get got make sure let lets let\'s need want into up out about all any some one more very really okay ok hey ' +
    // words that say nothing about the task
    'because everything anything something nothing what\'s it\'s that\'s there\'s you\'re i\'m don\'t can\'t won\'t didn\'t isn\'t ' +
    'think know like thing things going go see look still again already actually maybe right good great well even ' +
    'fuck fucking fucked shit damn bloody').split(' '),
)

export const words = (s: string) =>
  s.toLowerCase().replace(/\(link\)/g, ' ').replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).map(w => w.replace(/^['-]+|['-]+$/g, '')).filter(Boolean)

// Phrases of 2-3 words that start and end on a real word, plus single words of 8+ letters
// ("screenshot"), so a lone common word never ranks.
const POLITE = /^(?:(?:ok(?:ay)?|so|and|but|right|also|hey|great|cool|now|then|please|pls|claude)\s+)*(?:(?:can|could|would|will) (?:you|we)\s+|i (?:need|want) you to\s+|(?:(?:you|we|i) )?need to\s+|(?:let'?s)\s+|please\s+)*/

// How the ask starts, politeness removed: "can you show me the render" -> "show me", "show me the".
// Repeat asks repeat their opening words far more than their topic words.
const QUESTION = new Set('what is are do does did how where why when who which was were has have can could would will should shall i it this that there the a we you'.split(' '))

const VAGUE = new Set('it this that the a an them these those'.split(' '))

export function opener(ask: string): string[] {
  const w = words(ask.toLowerCase().replace(POLITE, ''))
  const out: string[] = []
  // A question needs its third word to say anything ("are you" -> "are you sure").
  // So does "make it" ("make it shorter" and "make it sound human" are different asks).
  const lens = QUESTION.has(w[0]) || VAGUE.has(w[1]) ? [3] : [2, 3]
  for (const len of lens) if (w.length >= len) out.push(`> ${w.slice(0, len).join(' ')}`)
  return out
}

export function phrases(ask: string): string[] {
  const w = words(ask)
  const out = new Set<string>(opener(ask))
  for (let len = 1; len <= 3; len++) {
    for (let i = 0; i + len <= w.length; i++) {
      const g = w.slice(i, i + len)
      if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue
      if (len === 1 && g[0].length < 8) continue
      out.add(g.join(' '))
    }
  }
  return [...out]
}

export function audit(entries: Entry[], top = 10): { habits: Habit[]; prompts: number; asks: number; sessions: number } {
  const asks: { text: string; session: string }[] = []
  for (const e of entries) for (const a of extractAsks(e.text)) asks.push({ text: a, session: e.session })

  const where = new Map<string, Set<number>>()
  asks.forEach((a, i) => {
    for (const p of phrases(a.text)) {
      if (!where.has(p)) where.set(p, new Set())
      where.get(p)!.add(i)
    }
  })

  // Rank by how many asks carry the phrase; longer phrases win ties because they say more.
  const ranked = [...where.entries()]
    .map(([phrase, ids]) => ({ phrase, ids, sessions: new Set([...ids].map(i => asks[i].session)).size }))
    .filter(r => r.ids.size >= 3 && r.sessions >= 2)
    .sort((a, b) => b.ids.size - a.ids.size || b.phrase.split(' ').length - a.phrase.split(' ').length)

  const habits: Habit[] = []
  const taken = new Set<number>()
  for (const r of ranked) {
    const fresh = [...r.ids].filter(i => !taken.has(i))
    if (fresh.length < r.ids.size * 0.5) continue // mostly the same asks as a habit above it
    fresh.forEach(i => taken.add(i))
    const examples = [...new Set(fresh.map(i => asks[i].text))].slice(0, 2)
    habits.push({ n: habits.length + 1, phrase: r.phrase, count: r.ids.size, sessions: r.sessions, examples })
    if (habits.length >= top) break
  }
  return { habits, prompts: entries.length, asks: asks.length, sessions: new Set(entries.map(e => e.session)).size }
}

// "> show me" is how asks START; a plain phrase is something asks MENTION.
export const label = (phrase: string) => (phrase.startsWith('> ') ? `asks that start "${phrase.slice(2)}…"` : `asks about "${phrase}"`)

export function report(r: ReturnType<typeof audit>): string {
  if (!r.habits.length) return `Read ${r.prompts} prompts across ${r.sessions} sessions. No ask came up 3 or more times in 2 or more sessions yet.`
  const lines = [`Read ${r.prompts} prompts (${r.asks} asks) across your last ${r.sessions} sessions. What you ask again and again:`, '']
  for (const h of r.habits) {
    lines.push(`${h.n}. ${label(h.phrase)}: ${h.count} times, in ${h.sessions} sessions`)
    for (const ex of h.examples) lines.push(`     e.g. ${ex.length > 110 ? ex.slice(0, 109) + '…' : ex}`)
  }
  lines.push('', 'Type /mod-build <number> to build a mod that fixes one of these.')
  return lines.join('\n')
}
