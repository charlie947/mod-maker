import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { ago, liveOthers, updateCard } from './cards'
import type { Card } from './cards'

// Answers "which session is doing X?" and "talk to the other session" at a glance.
// Each session writes one card to ~/.claude/session-cards/<id>.json; the band reads them all.
// Nothing is sent anywhere: the Ask button only puts a draft line in your prompt.

const others = atom({ plugin: 'sessions-band', key: 'others' } as const, [])
const isHidden = atom({ plugin: 'sessions-band', key: 'isHidden' } as const, false)

let dir = ''
let selfId = ''
let mine: Card | null = null

async function scan($: any) {
  const now = await $.clock.now()
  const entries = await $.fs.list(dir).catch(() => [])
  const cards: Card[] = []
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue
    try {
      cards.push(JSON.parse(await $.fs.read(`${dir}/${e.name}`)))
    } catch { /* a half-written card is skipped until next scan */ }
  }
  const list = liveOthers(cards, selfId, now)
  await update($, others, () => list)
}

async function writeMine($: any, prompt: string) {
  const now = await $.clock.now()
  mine = updateCard(mine, selfId, await $.session.cwd(), prompt, now)
  await $.fs.write(`${dir}/${selfId}.json`, JSON.stringify(mine))
}

// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  dir = `${(await $.env.get('HOME')) ?? ''}/.claude/session-cards`
  selfId = await $.session.id()
  await $.command.register({ name: 'sessions', description: 'Show or hide the band of other open sessions' })
  await scan($)
  $.clock.every(60e3, () => void scan($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    // Only what a person typed describes the session: not job notices or peer messages.
    const typed = (e as any).origin?.kind === undefined || (e as any).origin?.kind === 'composer'
    if (typed && e.text.trim()) await writeMine($, e.text).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setup($)
    if (mine) await writeMine($, mine.now).catch(() => undefined) // keep the card fresh while working
    await scan($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await setup($)
    await $.fs.write(`${dir}/${selfId}.json`, JSON.stringify({ ...mine, updatedMs: 0 })).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await setup($)
    await update($, isHidden, h => !h)
    const list = await read($, others)
    const now = await $.clock.now()
    const lines = list.map(c => `${c.place}: ${c.purpose} (now: ${c.now}, ${ago(now - c.updatedMs)})`)
    return { text: list.length ? `${list.length} other sessions:\n${lines.join('\n')}` : 'No other sessions are running this mod.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, others)
    if ((e.props as any).hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(40, (e.props as any).bodyColumns ?? 80)
    const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
    return (
      <Box flexDirection="column">
        <Text dimColor>Other sessions ({list.length})</Text>
        {list.slice(0, 4).map(c => (
          <Box key={c.id} flexDirection="row">
            <Text>
              {short(c.place, 18)} · {short(c.purpose || c.now || 'just started', width - 40)} <Text dimColor>({ago(now - c.updatedMs)})</Text>{' '}
            </Text>
            <Button
              key={`ask-${c.id}`}
              label="Ask"
              onPress={() => $.prompt.fill({ text: `Ask the session in ${c.place} working on "${short(c.purpose || c.now, 60)}": ` })}
            />
          </Box>
        ))}
      </Box>
    )
  })
}
