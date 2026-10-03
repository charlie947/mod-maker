// Pure grading: how long the reply is, its longest sentence, and the jargon in it.

import type { Grade } from '../types'
export type { Grade }

export type Bar = { maxWords: number; maxSentence: number; maxJargon: number }
export const DEFAULT_BAR: Bar = { maxWords: 150, maxSentence: 20, maxJargon: 3 }

// Words a non-technical reader trips on. Kept short on purpose.
const JARGON = [
  'api', 'endpoint', 'payload', 'schema', 'idempotent', 'refactor', 'regex', 'stdout', 'stderr',
  'dependency', 'dependencies', 'runtime', 'async', 'callback', 'middleware', 'repo',
  'commit', 'diff', 'cli', 'json', 'yaml', 'webhook', 'cache', 'latency',
  'deprecated', 'instantiate', 'serialize', 'mutex', 'semver',
]

const words = (s: string) => s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w))

// Code blocks are not prose: they are left out of the counts.
const prose = (text: string) => text.replace(/```[\s\S]*?```/g, ' ')

export function grade(text: string, bar: Bar = DEFAULT_BAR): Grade {
  const body = prose(text)
  const flat = body.replace(/`[^`]*`/g, 'x')
  const n = words(flat).length
  const sentences = flat
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => words(s.replace(/^\s*([-*•]|\d+[.)])\s+/, '')).length)
  const longest = sentences.length ? Math.max(...sentences) : 0
  const found = new Set<string>()
  const lower = ` ${body.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `
  for (const j of JARGON) if (lower.includes(` ${j} `)) found.add(j)
  // Inline code that is not a file path reads as jargon to most people.
  for (const m of body.matchAll(/`([^`\n]{2,40})`/g)) if (!/[/~\\]/.test(m[1])) found.add(m[1])
  const jargon = [...found]
  const reasons: string[] = []
  if (n > bar.maxWords) reasons.push(`${n} words`)
  if (longest > bar.maxSentence) reasons.push(`a ${longest}-word sentence`)
  if (jargon.length >= bar.maxJargon) reasons.push(`${jargon.length} jargon words`)
  return { words: n, longest, jargon, over: reasons.length > 0, reasons }
}
