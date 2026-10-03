// Pure helpers: one small card per session, written to a shared folder and read back.

import type { Card, State } from '../types'
export type { Card, State }

export const STALE_MS = 15 * 60e3 // a session silent for 15 minutes drops off the band

// Removes tagged blocks innermost first, so a notice with tags inside it goes whole.
const untag = (s: string) => {
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/<([a-z][\w-]*)[^>]*>[^<]*<\/\1>/gi, ' ')
  }
  return s.replace(/<\/?[a-z][\w-]*[^>]*>/gi, ' ')
}

export const clean = (s: string, n: number) => {
  const t = untag(s)
    .replace(/\[(Image|Pasted text)[^\]]*\]/gi, ' ')
    .replace(/(file:\/\/|https?:\/\/)\S+/g, '(link)')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function updateCard(card: Card | null, id: string, cwd: string, prompt: string, nowMs: number): Card {
  const text = clean(prompt, 90)
  const place = cwd.split('/').filter(Boolean).pop() ?? cwd
  if (!card) return { id, place, purpose: text, now: text, updatedMs: nowMs }
  // A prompt that was all pasted tags (a peer message, a reminder) cleans to nothing:
  // it must not blank the card, and the first real prompt still sets the purpose.
  return { ...card, place, purpose: card.purpose || text, now: text || card.now, updatedMs: nowMs }
}

export function liveOthers(cards: Card[], selfId: string, nowMs: number): Card[] {
  return cards
    .filter(c => c.id !== selfId && nowMs - c.updatedMs < STALE_MS)
    .sort((a, b) => b.updatedMs - a.updatedMs)
}

export const ago = (ms: number) => (ms < 60e3 ? 'now' : `${Math.round(ms / 60e3)}m ago`)

// The time on a row: how long it has run, how long a finished turn took, or how long it has waited for you.
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function rowTime(c: Card, nowMs: number): string {
  if (c.state === 'running') return mmss(nowMs - (c.startMs ?? c.updatedMs))
  if (c.state === 'needs') return `waiting ${mmss(nowMs - c.updatedMs)}`
  if (c.state === 'done') return mmss((c.endMs ?? c.updatedMs) - (c.startMs ?? c.updatedMs))
  return ''
}

// A running row has no known length, so a short block slides back and forth along a dotted track.
export function bar(c: Card, nowMs: number, cells: number): { before: string; block: string; after: string } {
  if (c.state === 'done') return { before: '', block: '█'.repeat(cells), after: '' }
  if (c.state === 'needs') return { before: '', block: '▓▓', after: '·'.repeat(cells - 2) }
  if (c.state !== 'running') return { before: '·'.repeat(cells), block: '', after: '' }
  const w = 3, span = cells - w
  const phase = [...c.id].reduce((h, ch) => h + ch.charCodeAt(0) * 7, 0) // rows slide out of step with each other
  const step = (Math.floor(nowMs / 250) + phase) % (span * 2)
  const at = step <= span ? step : span * 2 - step
  return { before: '·'.repeat(at), block: '▓'.repeat(w), after: '·'.repeat(cells - w - at) }
}

// Who needs you comes first, then what is running, then what finished.
const rank: Record<string, number> = { needs: 0, running: 1, done: 2 }
export const order = (cards: Card[]) => [...cards].sort((a, b) => (rank[a.state ?? 'done'] ?? 3) - (rank[b.state ?? 'done'] ?? 3) || b.updatedMs - a.updatedMs)

export function summary(cards: Card[]) {
  const n = (s: State) => cards.filter(c => c.state === s).length
  return { running: n('running'), done: n('done'), needs: n('needs') }
}
