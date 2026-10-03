import { label, words } from './audit'
import type { Habit } from './audit'
import type { Repeat } from '../types'

// The habit spotter: groups the asks typed in this session and says when one comes up a
// third time. Two asks are "the same" when they share most of their real words.

const SMALL = new Set('a an the and or but so to of in on at for with is are it this that i me my we you your can could would will do please pls just it\'s'.split(' '))

export const keyWords = (ask: string) => [...new Set(words(ask).filter(w => !SMALL.has(w) && w.length > 1))]

export function same(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const shared = a.filter(w => b.includes(w)).length
  const small = Math.min(a.length, b.length)
  return small <= 2 ? shared === small && Math.abs(a.length - b.length) <= 1 : shared / small >= 0.6
}

// Adds asks to the session's groups. Returns the groups and any that just reached the threshold.
export function track(groups: readonly Repeat[], asks: string[], threshold = 3): { groups: Repeat[]; hit: Repeat | null } {
  const next = groups.map(g => ({ ...g, examples: [...g.examples] }))
  let hit: Repeat | null = null
  for (const ask of asks) {
    const k = keyWords(ask)
    if (!k.length) continue
    const g = next.find(x => same(x.keys, k))
    if (g) {
      g.count++
      if (!g.examples.includes(ask)) g.examples.push(ask)
      if (g.count >= threshold && !g.offered) {
        g.offered = true
        hit = g
      }
    } else {
      next.push({ text: ask, keys: k, count: 1, examples: [ask], offered: false })
    }
  }
  return { groups: next, hit }
}

// The prompt that asks Claude to build the mod. Shared by /mod-build and the band.
export function buildPrompt(h: { phrase: string; count: number; sessions?: number; examples: string[] }): string {
  const what = h.phrase.startsWith('> ') || h.sessions ? label(h.phrase) : `"${h.phrase}"`
  const where = h.sessions ? `${h.count} times across ${h.sessions} sessions` : `${h.count} times in this session`
  return [
    'Use the plugin-authoring skill to build a Claude Code mod so I stop having to ask for this.',
    `The repeat ask: ${what} (${where}).`,
    'How I ask it:',
    ...h.examples.slice(0, 3).map(e => `- ${e}`),
    'Make the mod do the thing I keep asking for by itself, or show me the answer before I ask. Keep it small and give it a clear name.',
    'Write at least one test. Run `claude plugin validate` and `claude plugin test` on it until both pass.',
    'Then call the mcp__mod-maker__check_mod tool on its folder and show me, in plain English, what the mod can read, run and send.',
  ].join('\n')
}

export type { Habit }
