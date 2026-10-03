// Pure logic for the office: what each tool call looks like in the world, the ETA maths, and
// the text shown in a message bubble. No engine calls here, so the tests can reach all of it.

export type Step = { label: string; estMin: number; startMs?: number; doneMs?: number }
export type Intern = { key: string; label: string; startMs: number; background: boolean }
export type FileMark = { name: string; ms: number; kind: 'read' | 'edit' }
export type Sent = { key: string; to: string; words: string; ms: number }
export type Got = { key: string; from: string; words: string; ms: number }
export type Eta = { finishMs: number; plannedMs: number; lateMin: number; allDone: boolean }
export type Desk = {
  id: string
  name: string
  activity: string
  detail: string
  activityMs: number
  steps: Step[]
  planMs: number
  eta?: Eta
  interns: Intern[]
  files: FileMark[]
  sent: Sent[]
  got: Got[]
  turnMs: number
  doneMs: number
  doneLine: string
  updatedMs: number
  endedMs?: number
  // Names this Claude gave its teammates (from-name or address -> CEO), and which address
  // sent under which from-name, so a reply addressed by socket still gets a name.
  peers?: Record<string, string>
  seen?: Record<string, string>
}

export const newDesk = (id: string, name: string, now: number): Desk => ({
  id, name, activity: 'idle', detail: 'Coffee', activityMs: now, steps: [], planMs: 0,
  interns: [], files: [], sent: [], got: [], turnMs: 0, doneMs: 0, doneLine: '', updatedMs: now,
})

export const baseName = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''

// A short plain name reads well ("intro.md"). A long or machine-made one ("s02-plane-ceo-cto.png")
// is shown as what it is ("a screenshot") so a label never turns into noise.
const KINDS: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp)$/i, 'a screenshot'], [/\.(mp4|mov|webm)$/i, 'a video'],
  [/\.(md|txt|docx?)$/i, 'a doc'], [/\.(html?|css)$/i, 'a web page'], [/\.(json|ya?ml|toml)$/i, 'a settings file'],
  [/\.(tsx?|jsx?|py|sh|go|rs)$/i, 'some code'], [/\.(csv|xlsx?)$/i, 'a spreadsheet'], [/\.pdf$/i, 'a PDF'],
]
export const plainFile = (name: string) => {
  if (name.length <= 10 && !/\d/.test(name)) return name
  return KINDS.find(([re]) => re.test(name))?.[1] ?? 'a file'
}

// Where the character goes for each tool. null = draw nothing new (the office's own tools).
export function activityOf(tool: string, input: any): { activity: string; detail: string; file?: FileMark['kind'] } | null {
  if (tool.startsWith('mcp__office__')) return null
  const f = plainFile(baseName(input?.file_path ?? input?.notebook_path))
  switch (tool) {
    case 'Read': return { activity: 'read', detail: f ? `Reading ${f}` : 'Reading', file: 'read' }
    case 'Grep': case 'Glob': return { activity: 'read', detail: 'Searching the files' }
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { activity: 'edit', detail: f ? `Editing ${f}` : 'Editing', file: 'edit' }
    case 'Write': return { activity: 'edit', detail: f ? `Writing ${f}` : 'Writing', file: 'edit' }
    case 'Bash': {
      const d = String(input?.description ?? '').trim()
      return { activity: 'bash', detail: d ? clean(d[0].toUpperCase() + d.slice(1), 60) : 'Running a command' }
    }
    case 'WebFetch': case 'WebSearch': return { activity: 'web', detail: 'Looking something up' }
    case 'Agent': case 'Task': return { activity: 'agent', detail: 'Briefing a helper' }
    case 'SendMessage': return { activity: 'send', detail: 'Sending a note' }
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return { activity: 'think', detail: 'Planning' }
    default:
      if (tool.startsWith('mcp__')) return { activity: 'web', detail: `Using ${tool.split('__')[1] ?? 'an app'}` }
      return { activity: 'think', detail: 'Thinking' }
  }
}

// Paths and long ids never reach the page: a bubble shows words, not where files live.
export const clean = (s: string, n: number) => {
  const t = s.replace(/(~|\.{0,2})?\/[^\s"'`]+/g, '…').replace(/\b[0-9a-f]{8}-[0-9a-f-]{20,}\b/gi, '…').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// A bubble shows the first whole sentence, never a sentence cut in half. A long first sentence
// stops at its first comma or colon past the halfway point; only a run-on gets an ellipsis.
export const firstWords = (s: string, n = 26) => {
  const t = clean(s, 400)
  const first = (t.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? t).trim()
  const w = first.split(' ').filter(Boolean)
  if (w.length <= n) return w.join(' ')
  const head = w.slice(0, n).join(' ')
  const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf(': '))
  return cut > head.length / 2 ? head.slice(0, cut) : `${head}…`
}

// The same message must give the same key on the sending desk and the receiving desk.
export const msgKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 48)

// A peer message arrives inside an envelope: <cross-session-message from=".." from-name="..">body</..>
export function parseReceived(text: string): { from: string; addr: string; body: string } {
  const addr = text.match(/<cross-session-message[^>]*?\sfrom="([^"]*)"/)?.[1] ?? ''
  const m = text.match(/<cross-session-message[^>]*?(?:from-name="([^"]*)")?[^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/)
  if (!m) return { from: '', addr, body: text.trim() }
  const name = text.match(/from-name="([^"]*)"/)?.[1] ?? ''
  return { from: name, addr, body: m[2].trim() }
}

export function planSteps(raw: unknown, now: number): Step[] {
  const list = Array.isArray(raw) ? raw.slice(0, 8) : []
  const steps = list
    .map((s: any) => ({ label: clean(String(s?.label ?? s ?? ''), 40), estMin: Math.max(0, Number(s?.minutes ?? 0)) }))
    .filter(s => s.label)
  if (steps[0]) steps[0] = { ...steps[0], startMs: now }
  return steps
}

export function finishStep(steps: Step[], n: number, now: number): Step[] {
  const out = steps.map(s => ({ ...s }))
  const s = out[n - 1]
  if (!s || s.doneMs) return out
  s.startMs = s.startMs ?? now
  s.doneMs = now
  const next = out.find(x => !x.doneMs)
  if (next && !next.startMs) next.startMs = now
  return out
}

// The finish time re-estimates from the real pace so far: steps done took r times their guess,
// so the steps left are expected to take about r times theirs too. A step that runs past its share
// pushes the finish later every tick, so a slip always shows.
export function eta(steps: Step[], planMs: number, now: number): Eta | undefined {
  if (!steps.length || steps.every(s => !s.estMin)) return undefined
  const MIN = 60_000
  const done = steps.filter(s => s.doneMs)
  const est = done.reduce((a, s) => a + s.estMin * MIN, 0)
  const act = done.reduce((a, s) => a + ((s.doneMs ?? 0) - (s.startMs ?? planMs)), 0)
  // Trust the measured pace in proportion to how much of the plan it covers: one quick first
  // step out of six must not shrink the whole estimate (a live run did: 14:58 became 14:07).
  const total = steps.reduce((a, s) => a + s.estMin * MIN, 0)
  const raw = done.length && est > 0 ? Math.min(4, Math.max(0.25, act / est)) : 1
  const r = 1 + (raw - 1) * (total > 0 ? est / total : 0)
  let left = 0
  for (const s of steps) {
    if (s.doneMs) continue
    const share = s.estMin * MIN * r
    left += s.startMs ? Math.max(0, share - (now - s.startMs)) : share
  }
  const allDone = steps.every(s => s.doneMs)
  const finishMs = allDone ? Math.max(...steps.map(s => s.doneMs ?? 0)) : now + left
  const plannedMs = planMs + steps.reduce((a, s) => a + s.estMin * MIN, 0)
  return { finishMs, plannedMs, lateMin: Math.max(0, Math.round((finishMs - plannedMs) / MIN)), allDone }
}

export const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const push = <T>(list: T[], item: T, max: number) => [...list, item].slice(-max)

// One tool call, applied to the desk: where the character goes, which file glows, which intern
// walks in. File names only: the folder never reaches the desk file.
export function applyTool(d: Desk, tool: string, input: any, key: string, now: number): Desk {
  const a = activityOf(tool, input)
  if (!a) return d
  const out = { ...d, activity: a.activity, detail: a.detail, activityMs: now }
  const f = plainFile(baseName(input?.file_path ?? input?.notebook_path))
  if (a.file && f) out.files = push(d.files.filter(x => x.name !== f), { name: f, ms: now, kind: a.file }, 12)
  if (a.activity === 'agent') {
    out.interns = push(d.interns, { key, label: firstWords(String(input?.description ?? 'Helper'), 3), startMs: now, background: Boolean(input?.run_in_background) }, 6)
  }
  return out
}

export const dataJs = (now: number, desks: Desk[]) =>
  `window.__office && window.__office(${JSON.stringify({ now, desks })})\n`

// The name to show for a teammate: the role this Claude gave it, else its own session name.
export function peerName(d: Pick<Desk, 'peers' | 'seen'>, who: string) {
  const peers = d.peers ?? {}
  const viaAddr = d.seen?.[who]
  return peers[who] ?? (viaAddr ? peers[viaAddr] ?? viaAddr : who)
}
