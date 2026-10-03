import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Loop } from '../types'
import { extractAsks } from './extract'

const PANE = 'open-loops'
const loops = atom({ plugin: 'open-loops', key: 'loops' } as const, [])
const nextId = atom({ plugin: 'open-loops', key: 'nextId' } as const, 1)
// Ask-splitter: the loop ids caught from the latest prompt, shown above the prompt box.
const heard = atom({ plugin: 'open-loops', key: 'heard' } as const, [])

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const openOf = (list: readonly Loop[]) => list.filter(l => l.status === 'open')

async function addLoops($: any, texts: string[]): Promise<Loop[]> {
  if (texts.length === 0) return []
  const first = await read($, nextId)
  await update($, nextId, n => (n ?? 1) + texts.length)
  const added = texts.map((text, i) => ({ id: first + i, text, status: 'open' as const }))
  await update($, loops, list => [...(list ?? []), ...added])
  return added
}

async function setStatus($: any, id: number, status: Loop['status'], proof: string) {
  let found = false
  await update($, loops, list =>
    (list ?? []).map(l => {
      if (l.id !== id) return l
      found = true
      return { ...l, status, proof }
    }),
  )
  return found
}

async function refreshStatus($: any) {
  const open = openOf(await read($, loops)).length
  $.ui.status(open === 0 ? undefined : `Open loops: ${open}`)
}

function reminder(open: readonly Loop[], added: readonly Loop[]) {
  const lines = [
    "OPEN LOOPS (open-loops mod). Every ask the user makes is tracked in a pane they can see.",
  ]
  if (added.length) {
    lines.push(`Auto-captured from this prompt: ${added.map(l => `L${l.id} "${short(l.text, 70)}"`).join('; ')}.`)
  }
  if (open.length) {
    lines.push('Still open:')
    for (const l of open) lines.push(`- L${l.id}: ${short(l.text, 160)}`)
  }
  lines.push(
    'Rules: call mcp__open-loops__close_loop with the id and concrete proof (a path, link, sent-message line or tool result) when an ask is finished. ' +
      'If the capture missed an ask in this prompt, call mcp__open-loops__add_loop. ' +
      'If a captured line is not a real ask, or the user cancels it, call mcp__open-loops__drop_loop with the reason. ' +
      'Never close a loop without proof from this session.',
  )
  return lines.join('\n')
}

// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  await $.command.register({ name: 'loops', description: 'Show every ask from this session and what is still open' })
  await $.tool.register({
    name: 'close_loop',
    description: "Mark one of the user's tracked asks as finished. Give the loop id and the proof.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, proof: { type: 'string', description: 'Path, link, sent line or tool result that proves it is done' } },
      required: ['id', 'proof'],
    },
  })
  await $.tool.register({
    name: 'add_loop',
    description: "Track an ask from the user's prompt that the auto-capture missed.",
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  })
  await $.tool.register({
    name: 'drop_loop',
    description: 'Remove a tracked line that was not a real ask, or that the user cancelled. Give the reason.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, reason: { type: 'string' } },
      required: ['id', 'reason'],
    },
  })
  void $.ui.open({ id: PANE, title: 'Open loops' })
  await refreshStatus($)
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('command.run', { command: 'loops' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Open loops' }).catch(() => undefined) // the text answer still lists them
    const list = await read($, loops)
    const open = openOf(list)
    const text =
      open.length === 0
        ? `No open loops. ${list.length} asks tracked this session.`
        : `${open.length} open:\n${open.map(l => `L${l.id}  ${l.text}`).join('\n')}`
    return { text }
  })

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    const added = await addLoops($, extractAsks(e.text))
    // A prompt with no asks (a "go", a pasted note) keeps the last list on screen.
    if (added.length) await update($, heard, () => added.map(l => l.id))
    const open = openOf(await read($, loops))
    await refreshStatus($)
    if (open.length === 0 && added.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), reminder(open, added)] })
  })

  on('tool.call', { tool: 'mcp__open-loops__close_loop' }, async ($, e: any) => {
    const id = Number(e.id)
    const proof = String(e.proof ?? '').trim()
    if (!proof) return { result: `L${id} not closed: proof is required.` }
    const found = await setStatus($, id, 'done', proof)
    await refreshStatus($)
    return { result: found ? `L${id} closed.` : `No loop L${id}.` }
  })

  on('tool.call', { tool: 'mcp__open-loops__add_loop' }, async ($, e: any) => {
    const [l] = await addLoops($, [String(e.text ?? '').trim()].filter(Boolean))
    await refreshStatus($)
    return { result: l ? `Tracking L${l.id}.` : 'Nothing added: text was empty.' }
  })

  on('tool.call', { tool: 'mcp__open-loops__drop_loop' }, async ($, e: any) => {
    const id = Number(e.id)
    const found = await setStatus($, id, 'dropped', String(e.reason ?? 'dropped'))
    await refreshStatus($)
    return { result: found ? `L${id} dropped.` : `No loop L${id}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, loops)
    const open = openOf(list)
    const closed = list.filter(l => l.status !== 'open').slice(-6)
    const width = Math.max(30, (e.props as any)?.bodyColumns ?? 60)
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 8)

    return (
      <Box flexDirection="column">
        <Text bold>
          {open.length} open · {list.length - open.length} done
        </Text>
        {list.length === 0 && <Text dimColor>No asks yet. Each ask you type shows here.</Text>}
        {open.slice(0, room).map(l => (
          <Box key={`o${l.id}`} flexDirection="row">
            <Text>
              L{l.id} {short(l.text, width - 16)}{' '}
            </Text>
            <Button
              key={`done${l.id}`}
              label="✓"
              onPress={async () => {
                await setStatus($, l.id, 'done', 'ticked by you')
                await refreshStatus($)
              }}
            />
            <Button
              key={`drop${l.id}`}
              label="✗"
              onPress={async () => {
                await setStatus($, l.id, 'dropped', 'dropped by you')
                await refreshStatus($)
              }}
            />
          </Box>
        ))}
        {open.length > room && <Text dimColor>…and {open.length - room} more (/loops)</Text>}
        {closed.length > 0 && <Text dimColor>Recently closed</Text>}
        {closed.map(l => (
          <Text key={`c${l.id}`} dimColor>
            {l.status === 'done' ? '✓' : '✗'} L{l.id} {short(l.text, width - 12)}
            {l.proof ? ` (${short(l.proof, 40)})` : ''}
          </Text>
        ))}
      </Box>
    )
  })

  // Ask-splitter band: "I heard 3 asks", numbered, each ticking as its proof arrives.
  // It draws above whatever the plugins beneath draw, so no other band is hidden.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ids = await read($, heard)
    const list = (await read($, loops)).filter(l => ids.includes(l.id))
    const below = await next(e)
    if ((e.props as any).hasSurvey || list.length === 0) return below
    const { Box, Text } = $.ui.resolve(e)
    const accent = '#D97557'
    const width = Math.max(40, Math.min(100, (e.props as any).bodyColumns ?? 80))
    const done = list.filter(l => l.status === 'done').length
    const mark = (l: Loop) => (l.status === 'done' ? '✓' : l.status === 'dropped' ? '✗' : '○')
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold color={accent}>{`◆ I heard ${list.length} ask${list.length === 1 ? '' : 's'}`}</Text>
          <Text dimColor>{`   ${done} of ${list.length} done · each one ticks only with proof · /loops`}</Text>
        </Text>
        {list.map((l, i) => (
          <Text key={`h${l.id}`} color={l.status === 'done' ? 'green' : undefined} dimColor={l.status === 'dropped'}>
            {`  ${i + 1}. ${mark(l)} ${short(l.text, width - (l.status === 'done' && l.proof ? 34 : 8))}`}
            {l.status === 'done' && l.proof ? <Text dimColor>{`  (${short(l.proof, 24)})`}</Text> : null}
          </Text>
        ))}
        {below}
      </Box>
    )
  })
}
