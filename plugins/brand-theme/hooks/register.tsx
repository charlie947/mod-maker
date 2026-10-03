import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { BRAND, bandFacts, elapsed, frame, meter, summary } from './theme'

// Dresses Claude Code in one brand. Change the colours in ./theme.ts (the BRAND block).
// Restyles three things Claude Code draws (the spinner, tool rows, the question dialog)
// and adds a band above the prompt. Terminal only: the desktop app keeps its own look.

const tick = atom({ plugin: 'brand-theme', key: 'tick' } as const, 0)
const turnStartMs = atom({ plugin: 'brand-theme', key: 'turnStartMs' } as const, 0)
const contextPercent = atom({ plugin: 'brand-theme', key: 'contextPercent' } as const, -1)

let working = false
let timer: { cancel: () => void } | undefined

async function readContext($: any) {
  const usage = await $.session.usage().catch(() => undefined)
  const p = usage?.context?.percent
  if (typeof p === 'number') await update($, contextPercent, () => p)
}

// Open loops come from the open-loops mod when it is installed. Without it, the band leaves the count out.
async function openLoops($: any): Promise<number | undefined> {
  const r = await $.state.get({ plugin: 'open-loops', key: 'loops' }).catch(() => undefined)
  const list = r?.value as Array<{ status: string }> | undefined
  return Array.isArray(list) ? list.filter(l => l.status === 'open').length : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await readContext($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    working = true
    const now = await $.clock.now()
    await update($, turnStartMs, () => now)
    // The spinner turns 4 times a second while Claude works.
    timer?.cancel()
    timer = $.clock.every(250, () => {
      if (working) void update($, tick, t => t + 1)
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e) // a subagent finishing is not the main turn ending
    working = false
    timer?.cancel()
    timer = undefined
    await readContext($)
    return next(e)
  })

  // 1. The spinner: a sky circle, the word in white, the time in the hairline colour.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    const t = await read($, tick)
    const start = await read($, turnStartMs)
    const now = await $.clock.now()
    const word = e.props.message || e.props.word || 'Working'
    const ends = word.endsWith('…') ? '' : '…'
    return (
      <Text>
        <Text color={BRAND.signal} bold>{`${frame(t)} `}</Text>
        <Text color={BRAND.text} bold>{`${word}${ends}`}</Text>
        <Text color={BRAND.signal}>{start ? `  ${elapsed(now - start)}` : ''}</Text>
      </Text>
    )
  })

  // 2. Tool rows. The one running now is the active item, so it carries the signal colour.
  // A finished row keeps Claude Code's own drawing, so its result and error colour stay true.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return next(e)
    const { Text } = $.ui.resolve(e)
    const about = summary(e.props.input)
    return (
      <Text>
        <Text color={BRAND.signal} bold>{'▍ '}</Text>
        <Text color={BRAND.signal} bold>{e.props.tool}</Text>
        <Text color={BRAND.text}>{about ? `  ${about}` : ''}</Text>
      </Text>
    )
  })

  // 3. The question dialog: a branded header above Claude Code's own dialog, which stays whole.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={BRAND.signal} bold>{'◆ YOUR CALL'}</Text>
          <Text color={BRAND.text}>{'  Claude needs an answer before it carries on'}</Text>
        </Text>
        {theirs}
      </Box>
    )
  })

  // 4. The band above the prompt: your name, open loops, context used.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const pct = await read($, contextPercent)
    const loops = await openLoops($)
    const facts = bandFacts(loops, pct >= 0 ? pct : undefined)
    const m = pct >= 0 ? meter(pct) : undefined
    const width = Math.max(40, e.props.bodyColumns - 4) // 4 cells stay free for the band's [-] marker
    const left = ` ◆ ${BRAND.name} `
    const right = facts.length ? ` ${facts.join('  ·  ')} ` : ''
    const gap = Math.max(1, width - left.length - right.length - (m ? 12 : 0))
    // Other mods share this band: draw theirs under ours, never instead of it.
    const theirs = await next(e)
    return (
      <Box flexDirection="column">
        <Text backgroundColor={BRAND.card} wrap="truncate-end">
          <Text color={BRAND.signal} backgroundColor={BRAND.card} bold>{left}</Text>
          <Text backgroundColor={BRAND.card}>{' '.repeat(gap)}</Text>
          <Text color={BRAND.text} backgroundColor={BRAND.card}>{right}</Text>
          {m ? <Text color={BRAND.signal} backgroundColor={BRAND.card}>{m.full}</Text> : ''}
          {m ? <Text color={BRAND.line} backgroundColor={BRAND.card}>{`${m.empty}  `}</Text> : ''}
        </Text>
        {theirs ?? ''}
      </Box>
    )
  })
}
