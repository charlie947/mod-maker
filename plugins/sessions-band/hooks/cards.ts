// Pure helpers: one small card per session, written to a shared folder and read back.

import type { Card } from '../types'
export type { Card }

export const STALE_MS = 15 * 60e3 // a session silent for 15 minutes drops off the band

const clean = (s: string, n: number) => {
  const t = s
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
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
