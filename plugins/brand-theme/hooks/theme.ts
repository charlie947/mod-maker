// ─── YOUR BRAND ────────────────────────────────────────────────────────────
// Swap these for your own. Every colour the mod draws comes from this block.
// Default: the charliehills.ai palette (navy canvas, one sky signal).
export const BRAND = {
  name: 'CHARLIE HILLS', // shown at the left of the band
  canvas: '#00132F', // page background (set your terminal to this, see README)
  card: '#0A2342', // the band and panels sit on this
  line: '#1C3A5E', // hairlines: the gutter on finished tool rows
  signal: '#58B6FF', // ONE signal colour: spinner, the running tool, the active item
  text: '#FFFFFF', // words on the canvas
}
// ───────────────────────────────────────────────────────────────────────────

// Spinner frames: a quarter-filled circle turning, drawn in the signal colour.
export const FRAMES = ['◐', '◓', '◑', '◒']
export const frame = (tick: number) => FRAMES[Math.abs(tick) % FRAMES.length] ?? FRAMES[0]!

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

// One short line saying what a tool call is about, from its input.
export function summary(input: unknown, max = 70): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'prompt', 'path', 'skill']
  for (const k of pick) {
    const v = i[k]
    if (typeof v === 'string' && v.trim()) {
      const one = v.replace(/\s+/g, ' ').trim()
      return one.length > max ? `${one.slice(0, max - 1)}…` : one
    }
  }
  return ''
}

// The band's right-hand side: open loops (when that mod runs) and context used.
export function bandFacts(openLoops: number | undefined, contextPercent: number | undefined): string[] {
  const out: string[] = []
  if (openLoops !== undefined) out.push(openLoops === 1 ? '1 OPEN LOOP' : `${openLoops} OPEN LOOPS`)
  if (contextPercent !== undefined) out.push(`CONTEXT ${Math.round(contextPercent)}%`)
  return out
}

// A bar of `cells` blocks, filled to the percentage.
export function meter(percent: number, cells = 10): { full: string; empty: string } {
  const n = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return { full: '█'.repeat(n), empty: '░'.repeat(cells - n) }
}
