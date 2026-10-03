import type { Register } from 'claude-code'

import {
  activityOf, applyTool, clean, dataJs, type Desk, eta, finishStep, firstWords, hhmm, msgKey, newDesk,
  parseReceived, peerName, planSteps, push,
} from './core'

// The office: every session that runs this mod gets a desk in one shared pixel-art room.
// Each session writes only its own desk file under ~/.claude/office/desks/, then rebuilds
// ~/.claude/office/data.js from all the desk files. ~/.claude/office/index.html (a local page,
// no network) reads data.js every second and animates it. Nothing leaves the machine.

const LIVE_MS = 2 * 60 * 60_000
let desk: Desk | undefined
let home = ''
let chain: Promise<unknown> = Promise.resolve()
let ticker: { cancel: () => void } | undefined

const dir = () => `${home}/.claude/office`

const TOOLS = [
  {
    name: 'plan',
    description: 'Put the plan for this task on your office desk board, with your honest estimate in minutes for each step. The board shows a live "Done by" clock from these estimates and re-estimates from the real time each step takes.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, minutes: { type: 'number' } }, required: ['label', 'minutes'] },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'name_desk',
    description: 'Set the name tag on your desk in the office, for example CEO, CTO or Writer. Use the role the user or your team gave you.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'name_peer',
    description: 'Give a teammate session a short name on your office board, for example CEO. "who" is its session name or address exactly as a message from it shows (from-name or from).',
    inputSchema: { type: 'object', properties: { who: { type: 'string' }, name: { type: 'string' } }, required: ['who', 'name'] },
  },
  {
    name: 'step_done',
    description: 'Mark a plan step on your office desk board as finished (1-based).',
    inputSchema: { type: 'object', properties: { step: { type: 'number' } }, required: ['step'] },
  },
]

async function publish($: any) {
  const now = await $.clock.now()
  const desks: Desk[] = []
  const entries = await $.fs.list(`${dir()}/desks`).catch(() => [])
  for (const en of entries) {
    if (!en.name.endsWith('.json') || now - en.mtimeMs > LIVE_MS) continue
    try { desks.push(JSON.parse(await $.fs.read(`${dir()}/desks/${en.name}`))) } catch { /* a desk mid-write is skipped this time */ }
  }
  desks.sort((a, b) => a.id.localeCompare(b.id))
  await $.fs.write(`${dir()}/data.js`, dataJs(now, desks))
}

// Finds this session's desk: the saved one after a reload, or a new one.
async function ensure($: any) {
  if (desk && home) return
  home = (await $.env.get('HOME')) ?? ''
  const id = await $.session.id()
  const now = await $.clock.now()
  let saved: Desk | undefined
  try { saved = JSON.parse(await $.fs.read(`${dir()}/desks/${id}.json`)) } catch { saved = undefined }
  const name = String((await $.store.get(`name:${id}`)) ?? saved?.name ?? 'Claude')
  desk = saved ? { ...saved, name, endedMs: undefined } : newDesk(id, name, now)
}

// Writes are queued so two events never interleave their writes.
function save($: any, change: (d: Desk, now: number) => void) {
  chain = chain.then(async () => {
    await ensure($)
    if (!desk || !home) return
    const now = await $.clock.now()
    change(desk, now)
    desk.eta = eta(desk.steps, desk.planMs, now)
    desk.updatedMs = now
    await $.fs.write(`${dir()}/desks/${desk.id}.json`, JSON.stringify(desk))
    await publish($)
  }).catch(() => undefined)
  return chain
}

function startTicker($: any) {
  ticker?.cancel()
  ticker = $.clock.every(15_000, () => {
    if (!desk?.eta || desk.eta.allDone) { ticker?.cancel(); ticker = undefined; return }
    void save($, () => undefined)
  })
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
  await $.command.register({ name: 'desk', description: 'Name your desk in the office, for example /desk Writer' })
  await $.command.register({ name: 'office', description: 'Show where the office page is' })
  await ensure($)
  try { await $.fs.write(`${dir()}/index.html`, await $.fs.read(`${$.plugin.root}/web/office.html`)) } catch { /* page copy is best effort */ }
  await save($, () => undefined)
  if (desk?.eta && !desk.eta.allDone) startTicker($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('command.run', { command: 'desk' }, async ($, e: any) => {
    const name = clean(String(e.args ?? e.text ?? '').trim(), 14)
    if (!name) return { text: `Your desk is called ${desk?.name ?? 'Claude'}. Rename it with /desk <name>.` }
    await $.store.set(`name:${desk?.id}`, name)
    await save($, d => { d.name = name })
    return { text: `Your desk is now called ${name}.` }
  })

  on('command.run', { command: 'office' }, async () => ({
    text: `Open this page in your browser: file://${dir()}/index.html\nEvery session with the office mod gets a desk there. Rename yours with /desk <name>.`,
  }))

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    await save($, (d, now) => { d.activity = 'think'; d.detail = 'Reading the ask'; d.activityMs = now })
    return next({
      ...e,
      context: [...(e.context ?? []), 'OFFICE (office mod): your desk shows a live "Done by" clock. For a task of 2+ steps, call mcp__office__plan with each step and your honest minutes estimate, then mcp__office__step_done as each step finishes.'],
    })
  })

  on('turn.start', async ($, e, next) => {
    await save($, (d, now) => { d.turnMs = now; if (d.activity === 'idle') { d.activity = 'think'; d.detail = 'Thinking'; d.activityMs = now } })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__office__plan' }, async ($, e: any) => {
    let n = 0
    await save($, (d, now) => { d.steps = planSteps(e.steps, now); d.planMs = now; d.doneMs = 0; n = d.steps.length })
    startTicker($)
    const due = desk?.eta ? ` Done by ${hhmm(desk.eta.finishMs)}.` : ''
    return { result: `Plan on your desk board: ${n} steps.${due}` }
  })

  on('tool.call', { tool: 'mcp__office__name_desk' }, async ($, e: any) => {
    const name = clean(String(e.name ?? '').trim(), 14)
    if (!name) return { result: 'Not renamed: the name was empty.' }
    await ensure($)
    await $.store.set(`name:${desk?.id}`, name)
    await save($, d => { d.name = name })
    return { result: `Your desk is now called ${name}.` }
  })

  on('tool.call', { tool: 'mcp__office__name_peer' }, async ($, e: any) => {
    const who = String(e.who ?? '').trim()
    const name = clean(String(e.name ?? '').trim(), 14)
    if (!who || !name) return { result: 'Not saved: who and name are both needed.' }
    await save($, d => {
      d.peers = { ...(d.peers ?? {}), [who]: name }
      const rename = (x: string) => (x && peerName({ peers: { [who]: name }, seen: d.seen }, x) === name ? name : x)
      d.got = d.got.map(g => ({ ...g, from: rename(g.from) }))
      d.sent = d.sent.map(s => ({ ...s, to: rename(s.to) }))
    })
    return { result: `${who} shows as ${name} on your board.` }
  })

  on('tool.call', { tool: 'mcp__office__step_done' }, async ($, e: any) => {
    const n = Number(e.step)
    if (!desk?.steps[n - 1]) return { result: `No step ${n}.` }
    await save($, (d, now) => { d.steps = finishStep(d.steps, n, now) })
    const t = desk?.eta
    return { result: t ? `Step ${n} done. Now due ${hhmm(t.finishMs)}${t.lateMin ? `, ${t.lateMin} min late` : ''}.` : `Step ${n} done.` }
  })

  on('tool.call', async ($, e: any, next) => {
    await setup($)
    const a = activityOf(e.tool, e)
    if (!a) return next(e)
    const key = String(e.tool_use_id ?? `${e.tool}-${Math.random()}`)
    const isHelper = a.activity === 'agent'
    const background = isHelper && Boolean(e.run_in_background)
    await save($, (d, now) => { Object.assign(d, applyTool(d, e.tool, e, key, now)) })
    const result = await next(e)
    if (isHelper && !background) await save($, d => { d.interns = d.interns.filter(i => i.key !== key) })
    return result
  })

  on('session.send', async ($, e: any, next) => {
    await save($, (d, now) => {
      d.sent = push(d.sent, { key: msgKey(e.text), to: clean(peerName(d, String(e.to ?? '')), 24), words: firstWords(e.text), ms: now }, 20)
    })
    return next(e)
  })

  on('session.receive', async ($, e: any, next) => {
    const kind = e.origin?.kind
    if (!e.agentId && (kind === 'peer' || kind === 'peer-send-message')) {
      const { from, addr, body } = parseReceived(String(e.text ?? ''))
      await save($, (d, now) => {
        if (addr && from) d.seen = { ...(d.seen ?? {}), [addr]: from }
        d.got = push(d.got, { key: msgKey(body), from: clean(peerName(d, from || addr), 24), words: firstWords(body), ms: now }, 20)
      })
    }
    return next(e)
  })

  on('turn.complete', async ($, e: any, next) => {
    if (e.agentId) {
      // A background helper finished: the longest-serving one walks out.
      await save($, d => { const i = d.interns.findIndex(x => x.background); if (i >= 0) d.interns = d.interns.filter((_, j) => j !== i) })
      return next(e)
    }
    await save($, (d, now) => {
      d.activity = 'idle'; d.detail = 'Coffee'; d.activityMs = now
      if (!e.isAborted && d.turnMs && now - d.turnMs >= 15_000) {
        d.doneMs = now
        const s = d.steps.length ? ` · ${d.steps.filter(x => x.doneMs).length} of ${d.steps.length} steps` : ''
        d.doneLine = `Done in ${Math.round((now - d.turnMs) / 1000)}s${s}`
      }
    })
    if (!e.isAborted && desk?.doneMs && desk.doneMs >= desk.turnMs) await $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    ticker?.cancel()
    await save($, (d, now) => { d.endedMs = now; d.activity = 'gone'; d.detail = 'Gone home' })
    return next(e)
  })
}
