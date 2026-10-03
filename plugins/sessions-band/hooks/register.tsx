import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { ago, bar, clean, liveOthers, order, rowTime, summary, updateCard } from './cards'
import type { Card, State } from './cards'

// Answers "which session is doing X?" and "talk to the other session" at a glance.
// Each session writes one card to ~/.claude/session-cards/<id>.json; the band reads them all.
// Nothing is sent anywhere: the Ask button only puts a draft line in your prompt.

const others = atom({ plugin: 'sessions-band', key: 'others' } as const, [])
const isHidden = atom({ plugin: 'sessions-band', key: 'isHidden' } as const, false)
const nowMs = atom({ plugin: 'sessions-band', key: 'nowMs' } as const, 0)

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
  // Say once, by name, when another session starts waiting for you.
  const before = new Map((await read($, others)).map((c: Card) => [c.id, c.state]))
  for (const c of list) if (c.state === 'needs' && before.has(c.id) && before.get(c.id) !== 'needs') $.ui.toast(`${c.place} is waiting on you${c.waitingFor ? `: ${c.waitingFor}` : ''}`)
  await update($, others, () => list)
  await update($, nowMs, () => now)
}

// This session's own state goes on its card, so the other sessions can show it.
async function mark($: any, state: State, waitingFor?: string) {
  if (!mine) return
  const now = await $.clock.now()
  const startMs = state === 'running' && mine.state !== 'running' && mine.state !== 'needs' ? now : mine.startMs
  mine = { ...mine, state, startMs, endMs: state === 'done' ? now : undefined, waitingFor, updatedMs: now }
  await $.fs.write(`${dir}/${selfId}.json`, JSON.stringify(mine)).catch(() => undefined)
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
  $.clock.every(2000, () => void scan($))
  // Timers and the sliding block move between scans only while another session is running.
  $.clock.every(500, async () => {
    if (!(await read($, others)).some((c: Card) => c.state === 'running')) return
    const t = await $.clock.now()
    await update($, nowMs, () => t)
  })
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
    await mark($, 'running').catch(() => undefined)
    return next(e)
  })

  on('tool.check', async ($, e: any, next) => {
    const r: any = await next(e)
    if (e.tool_use_id && r?.decision === 'ask') await mark($, 'needs', clean(String(e.input?.description ?? e.tool), 40)).catch(() => undefined)
    return r
  })

  on('tool.call', async ($, e, next) => {
    await setup($)
    if (mine?.state === 'needs') await mark($, 'running').catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setup($)
    await mark($, 'done').catch(() => undefined)
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
    const list = order(await read($, others))
    const now = await $.clock.now()
    const word: Record<string, string> = { running: 'working', needs: 'WAITING ON YOU', done: 'finished' }
    const lines = list.map(c => `${word[c.state ?? ''] ?? 'idle'} · ${c.place}: ${c.state === 'needs' && c.waitingFor ? `asks: ${c.waitingFor}` : c.purpose || c.now} (${rowTime(c, now) || ago(now - c.updatedMs)})`)
    return { text: list.length ? `${list.length} other sessions:\n${lines.join('\n')}` : 'No other sessions are running this mod.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = order(await read($, others))
    if ((e.props as any).hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, nowMs) // redraws the timers and the sliding block as the clock ticks
    const now = await $.clock.now()
    const width = Math.max(56, Math.min(100, (e.props as any).bodyColumns ?? 80))
    const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
    const orange = '#D97557'
    const look: Record<string, { word: string; color: string }> = {
      running: { word: '▸ working', color: orange },
      needs: { word: '⚑ your turn', color: 'red' },
      done: { word: '✓ finished', color: 'green' },
    }
    const cells = 14
    const nameW = width - 13 - cells - 12 - 6
    const tally = summary(list)
    return (
      <Box flexDirection="column">
        {list.slice(0, 5).map(c => {
          const l = look[c.state ?? ''] ?? { word: '· idle', color: 'gray' }
          const b = bar(c, now, cells)
          const what = c.state === 'needs' && c.waitingFor ? `${c.place} · asks: ${c.waitingFor}` : `${c.place} · ${c.purpose || c.now || 'just started'}`
          return (
            <Box key={c.id} flexDirection="row">
              <Text>
                <Text color={l.color} bold={c.state === 'needs'}>{l.word.padEnd(13)}</Text>
                <Text>{short(what, nameW).padEnd(nameW)} </Text>
                <Text dimColor>{b.before}</Text>
                <Text color={l.color}>{b.block}</Text>
                <Text dimColor>{b.after}</Text>
                <Text dimColor={c.state !== 'needs'} color={c.state === 'needs' ? 'red' : undefined}>{` ${(rowTime(c, now) || ago(now - c.updatedMs)).padStart(10)} `}</Text>
              </Text>
              <Button
                key={`ask-${c.id}`}
                label="Ask"
                onPress={() => $.prompt.fill({ text: `Ask the session in ${c.place} working on "${short(c.purpose || c.now, 60)}": ` })}
              />
            </Box>
          )
        })}
        <Text>
          {tally.needs > 0 && <Text color="red" bold>{`⚑ ${tally.needs} waiting on you  `}</Text>}
          <Text dimColor>{`${tally.running} working · ${tally.done} finished · /sessions to list them`}</Text>
        </Text>
      </Box>
    )
  })
}
