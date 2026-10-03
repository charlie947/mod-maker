import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Mission } from '../types'
import { extractAsks } from './asks'
import { applyTask, clock, describe, finishStep, fromTodos, setPlan, tick } from './core'

// Mission control: one live panel above the prompt. The plan fills as a stage bar, a feed says
// what Claude is doing in plain English, your asks tick off with proof, and a chime plays when
// the turn ends. It reads tool calls and prompts in this session only and sends nothing anywhere.

const EMPTY: Mission = { steps: [], feed: [], asks: [], nextAsk: 1, startedMs: 0, nowMs: 0, running: false, doneBanner: '' }
const mission = atom({ plugin: 'mission-control', key: 'mission' } as const, EMPTY)

const FEED = 3
const plainRows = atom({ plugin: 'mission-control', key: 'plainRows' } as const, true)

// How its own tool calls read in the transcript.
const OWN: Record<string, (i: any) => string> = {
  set_plan: i => `Plan: ${(i.steps ?? []).length} steps`,
  step_done: i => (i.step == null ? 'Step done' : `Step ${i.step} done`),
  add_ask: () => 'Ask added',
  tick_ask: () => 'Ask ticked off',
}
const set = ($: any, fn: (m: Mission) => Partial<Mission>) => update($, mission, m => ({ ...(m ?? EMPTY), ...fn(m ?? EMPTY) }))
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const TOOLS = [
  {
    name: 'set_plan',
    description: 'Show the plan for this task as a stage bar the user can watch. Give 2 to 6 short steps in plain English, no tool names.',
    inputSchema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } } }, required: ['steps'] },
  },
  {
    name: 'step_done',
    description: 'Mark a plan step as finished (1-based). The bar fills and the next step lights up.',
    inputSchema: { type: 'object', properties: { step: { type: 'number' } }, required: ['step'] },
  },
  {
    name: 'add_ask',
    description: "Put an ask on the panel that did not come from a typed prompt (for example one sent by another session).",
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'tick_ask',
    description: "Tick off one of the user's asks once it is really done. Give the ask id and the proof.",
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, proof: { type: 'string' } }, required: ['id', 'proof'] },
  },
]

function reminder(m: Mission) {
  const open = m.asks.filter(a => !a.done)
  const lines = [
    'MISSION CONTROL (mission-control mod). The user watches a live panel of this turn.',
    'For any task of 2+ steps, first call mcp__mission-control__set_plan with short plain-English steps, then mcp__mission-control__step_done as each one finishes.',
  ]
  if (open.length) {
    lines.push(`Asks on the panel: ${open.map(a => `#${a.id} "${short(a.text, 70)}"`).join('; ')}.`)
    lines.push('Asks sent by another session go on with mcp__mission-control__add_ask. Call mcp__mission-control__tick_ask with the id and proof from this session when one is done. Never tick without proof.')
  }
  return lines.join('\n')
}

async function addAsks($: any, texts: string[]) {
  const first = (await read($, mission)).nextAsk
  await set($, m => ({
    asks: [...m.asks, ...texts.map((text, i) => ({ id: m.nextAsk + i, text, done: false }))].slice(-12),
    nextAsk: m.nextAsk + texts.length,
  }))
  return first
}

let timer: { cancel: () => void } | undefined

// Starts the panel's clock. Called from turn.start and, as a fallback, from the first tool
// call: in a live run (03/10/2026) the panel stayed hidden on a turn woken by a background job.
async function start($: any) {
  const now = await $.clock.now()
  await set($, () => ({ running: true, startedMs: now, nowMs: now, doneBanner: '', feed: [] }))
  timer?.cancel()
  timer = $.clock.every(1000, () => void $.clock.now().then(t => set($, () => ({ nowMs: t }))))
}

// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  for (const t of TOOLS) await $.tool.register(t)
  await $.command.register({ name: 'mission', description: 'Clear the mission control panel' })
  await $.command.register({ name: 'mission-rows', description: 'Switch plain-English tool rows on or off' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('command.run', { command: 'mission-rows' }, async $ => {
    await setup($)
    await update($, plainRows, v => !v)
    return { text: (await read($, plainRows)) ? 'Plain tool rows on.' : 'Plain tool rows off: the full rows are back.' }
  })

  on('command.run', { command: 'mission' }, async $ => {
    await setup($)
    await update($, mission, () => EMPTY)
    return { text: 'Mission control cleared.' }
  })

  on('turn.start', async ($, e, next) => {
    await setup($)
    await start($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    const typed = (e as any).origin?.kind === 'composer'
    const texts = typed ? extractAsks(e.text) : []
    if (texts.length) await addAsks($, texts)
    return next({ ...e, context: [...(e.context ?? []), reminder(await read($, mission))] })
  })

  on('tool.call', { tool: 'mcp__mission-control__add_ask' }, async ($, e: any) => {
    await setup($)
    const text = String(e.text ?? '').trim()
    if (!text) return { result: 'Nothing added: text was empty.' }
    const id = await addAsks($, [text])
    return { result: `Ask #${id} is on the panel.` }
  })

  on('tool.call', { tool: 'mcp__mission-control__set_plan' }, async ($, e: any) => {
    await setup($)
    if (!(await read($, mission)).running) await start($)
    const steps = setPlan(Array.isArray(e.steps) ? e.steps.slice(0, 8) : [])
    // A new plan is a new job: asks already ticked off drop away, open ones stay.
    await set($, m2 => ({ steps, asks: m2.asks.filter(a => !a.done) }))
    return { result: `Plan shown with ${steps.length} steps.` }
  })

  on('tool.call', { tool: 'mcp__mission-control__step_done' }, async ($, e: any) => {
    await setup($)
    const m = await read($, mission)
    const n = Number(e.step)
    if (!m.steps[n - 1]) return { result: `No step ${n}.` }
    await set($, m2 => ({ steps: finishStep(m2.steps, n) }))
    return { result: `Step ${n} done.` }
  })

  on('tool.call', { tool: 'mcp__mission-control__tick_ask' }, async ($, e: any) => {
    await setup($)
    const proof = String(e.proof ?? '').trim()
    if (!proof) return { result: 'Not ticked: proof is required.' }
    const r = tick((await read($, mission)).asks, Number(e.id), proof)
    if (r.found) await set($, () => ({ asks: r.asks }))
    return { result: r.found ? `Ask #${e.id} ticked.` : `No ask #${e.id}.` }
  })

  on('tool.call', async ($, e: any, next) => {
    await setup($)
    if (!(await read($, mission)).running) await start($)
    const line = describe(e.tool, e)
    if (line) await set($, m => ({ feed: [line, ...m.feed.filter(f => f !== line)].slice(0, FEED) }))
    if (e.tool === 'TodoWrite') await set($, () => ({ steps: fromTodos(e.todos) }))
    if (e.tool === 'TaskCreate' || e.tool === 'TaskUpdate') await set($, m => ({ steps: applyTask(m.steps, e.tool, e) }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setup($)
    if (e.agentId) return next(e)
    timer?.cancel()
    timer = undefined
    const m = await read($, mission)
    const now = await $.clock.now()
    const parts = [e.isAborted ? 'Stopped' : 'Done', `in ${clock(now - m.startedMs)}`]
    if (m.steps.length) parts.push(`${m.steps.filter(s => s.status === 'done').length} of ${m.steps.length} steps`)
    if (m.asks.length) parts.push(`${m.asks.filter(a => a.done).length} of ${m.asks.length} asks`)
    await set($, () => ({ running: false, nowMs: now, doneBanner: parts.join(' · ') }))
    if (!e.isAborted) await $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, mission)
    const hasContent = m.running || m.doneBanner || m.steps.length > 0 || m.asks.length > 0 || m.feed.length > 0
    if ((e.props as any).hasSurvey || !hasContent) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.min(78, Math.max(44, ((e.props as any).bodyColumns ?? 80) - 2))
    const cells = Math.max(12, width - 30)
    const n = m.steps.length
    const per = n ? Math.max(1, Math.floor(cells / n)) : cells
    const done = m.steps.filter(s => s.status === 'done').length
    const current = m.steps.find(s => s.status === 'now')
    const openAsks = m.asks.filter(a => !a.done)
    const shownAsks = [...m.asks.filter(a => a.done).slice(-2), ...openAsks.slice(0, 3)]
    const accent = '#D97557'

    // A short window gives the band 2 or 3 rows: the same facts on two lines, no frame.
    if (((e.props as any).maxRows ?? 12) < 10) {
      const barCells = Math.max(8, Math.min(16, width - 60))
      const filled = n ? Math.round((done / n) * barCells) : 0
      return (
        <Box flexDirection="column" width={width}>
          {!m.running && m.doneBanner ? (
            <Text bold color="black" backgroundColor="green">{` ✔ ${m.doneBanner} `}</Text>
          ) : (
            <Text>
              <Text bold color={accent}>MISSION CONTROL </Text>
              <Text color="green">{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(barCells - filled)}</Text>
              <Text> {n ? `${done} of ${n}` : 'no plan'} </Text>
              {current && <Text color={accent}>▶ {short(current.label, width - barCells - 32)}</Text>}
            </Text>
          )}
          <Text>
            <Text bold>NOW </Text>
            <Text color={m.running ? accent : undefined}>{short(m.feed[0] ?? (m.running ? 'Thinking…' : 'idle'), width - 28)}</Text>
            {m.asks.length > 0 && <Text dimColor>{`  ASKS ${m.asks.filter(a => a.done).length}/${m.asks.length} ✓`}</Text>}
            {m.running && <Text dimColor>{`  ${clock(m.nowMs - m.startedMs)}`}</Text>}
          </Text>
        </Box>
      )
    }

    // The hero view: a wide filled bar, every step as a checklist line, what Claude is doing
    // now, your asks, and the Done banner. Needs about 14 rows.
    const big = Math.max(20, width - 24)
    const filledBig = n ? Math.round((done / n) * big) : 0
    const mark = (st: string) => (st === 'done' ? '✓' : st === 'now' ? '▶' : '○')
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={m.running ? accent : 'green'} paddingX={1} width={width}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={accent}>◆ MISSION CONTROL</Text>
          <Text dimColor>{m.running ? `working · ${clock(m.nowMs - m.startedMs)}` : 'finished'}</Text>
        </Box>
        <Text>
          <Text color="green">{'█'.repeat(filledBig)}</Text>
          <Text dimColor>{'░'.repeat(big - filledBig)}</Text>
          <Text bold>{`  ${n ? `${done} of ${n} steps` : 'no plan yet'}`}</Text>
        </Text>
        {m.steps.slice(0, 6).map((st, i) => (
          <Text key={`s${i}`} color={st.status === 'done' ? 'green' : st.status === 'now' ? accent : undefined} dimColor={st.status === 'todo'} bold={st.status === 'now'}>
            {`  ${mark(st.status)} ${short(st.label, width - 10)}`}
          </Text>
        ))}
        <Box marginTop={1} flexDirection="row">
          <Text bold>NOW  </Text>
          <Text color={m.running ? accent : undefined}>{m.feed[0] ? short(m.feed[0], width - 12) : m.running ? 'Thinking…' : 'All done'}</Text>
        </Box>
        {shownAsks.length > 0 && (
          <Box flexDirection="column">
            {shownAsks.map((a, i) => (
              <Text key={`a${a.id}`}>
                <Text bold>{i === 0 ? 'ASKS ' : '     '}</Text>
                <Text color={a.done ? 'green' : undefined} dimColor={!a.done}>{a.done ? '✓' : '○'}</Text> {short(a.text, width - 14)}
              </Text>
            ))}
          </Box>
        )}
        {!m.running && m.doneBanner && (
          <Box marginTop={1}>
            <Text bold color="black" backgroundColor="green">{`  ✔ ${m.doneBanner}  `}</Text>
          </Box>
        )}
      </Box>
    )
  })

  // Plain rows in the transcript: "Editing intro.md" in place of a tool name and a full
  // folder path. /mission-rows turns them off and puts the engine's own rows back.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props as any
    if (!(await read($, plainRows))) return next(e)
    const own = OWN[String(p.tool).replace(/^mcp__mission-control__/, '')]
    const line = own ? own(p.input ?? {}) : describe(String(p.tool), p.input ?? {})
    if (!line || String(p.tool).startsWith('mcp__open-loops__')) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        <Text color={p.isErrored ? 'red' : p.isRunning ? '#D97557' : 'green'}>● </Text>
        <Text bold={!!own}>{line}</Text>
      </Text>
    )
  })

  // Its own tools' results say nothing a reader needs: the panel already shows them.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props as any
    if (!(await read($, plainRows)) || !String(p.tool ?? '').startsWith('mcp__mission-control__')) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
