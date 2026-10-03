import { expect, test } from 'claude-code/testing'

import { activityOf, applyTool, dataJs, eta, finishStep, firstWords, msgKey, newDesk, parseReceived, peerName, planSteps } from './core'

const MIN = 60_000
const T0 = 1_700_000_000_000

test('each tool sends the character to the right place, with file names only', async () => {
  expect(activityOf('Read', { file_path: '/Users/sam/notes/intro.md' })).toEqual({ activity: 'read', detail: 'Reading intro.md', file: 'read' })
  expect(activityOf('Edit', { file_path: '/Users/sam/notes/intro.md' })?.activity).toBe('edit')
  expect(activityOf('Bash', { description: 'count the words' })?.detail).toBe('Count the words')
  expect(activityOf('Agent', { description: 'x' })?.activity).toBe('agent')
  expect(activityOf('SendMessage', {})?.activity).toBe('send')
  expect(activityOf('mcp__office__plan', {})).toBeNull()
})

test('bubbles never show a path or a session id', async () => {
  const w = firstWords('Files ready in /Users/sam/Desktop/evidence/a.mp4 for 3f2a9c1d-1111-2222-3333-444455556666 now', 12)
  expect(w.includes('/')).toBe(false)
  expect(w.includes('3f2a9c1d')).toBe(false)
})

test('the sender and receiver of one message get the same key', async () => {
  const body = 'Mission control v2 files are ready (folder: evidence).'
  const wrapped = `<cross-session-message from="uds:/tmp/x.sock" from-name="ceo-session" from-mode="prompting">\n${body}\n</cross-session-message>`
  const got = parseReceived(wrapped)
  expect(got.from).toBe('ceo-session')
  expect(msgKey(got.body)).toBe(msgKey(body))
})

test('ETA: on plan, the finish is the sum of the estimates', async () => {
  const steps = planSteps([{ label: 'Read', minutes: 5 }, { label: 'Write', minutes: 10 }], T0)
  const e = eta(steps, T0, T0)!
  expect(e.finishMs).toBe(T0 + 15 * MIN)
  expect(e.lateMin).toBe(0)
})

test('ETA re-estimates from real step times: a slow first step pushes the finish later', async () => {
  let steps = planSteps([{ label: 'A', minutes: 5 }, { label: 'B', minutes: 10 }], T0)
  steps = finishStep(steps, 1, T0 + 10 * MIN) // took 10 min, guessed 5: pace is 2x
  const e = eta(steps, T0, T0 + 10 * MIN)!
  // pace 2x over a third of the plan: B is expected at 1 + (2 - 1) x 1/3 = 1.33 x 10 min
  expect(Math.round((e.finishMs - T0) / 1000)).toBe(10 * 60 + 800)
  expect(e.lateMin).toBe(8)
})

test('ETA never hides a slip: an overrunning step keeps moving the finish', async () => {
  const steps = planSteps([{ label: 'A', minutes: 5 }], T0)
  const e = eta(steps, T0, T0 + 9 * MIN)!
  expect(e.finishMs).toBe(T0 + 9 * MIN)
  expect(e.lateMin).toBe(4)
})

test('ETA: a fast pace brings the finish forward, and no estimates means no clock', async () => {
  let steps = planSteps([{ label: 'A', minutes: 10 }, { label: 'B', minutes: 10 }], T0)
  steps = finishStep(steps, 1, T0 + 5 * MIN)
  // pace 0.5x over half the plan: B is expected at 0.75 x 10 min
  expect(eta(steps, T0, T0 + 5 * MIN)!.finishMs).toBe(T0 + 12.5 * MIN)
  expect(eta(planSteps([{ label: 'A', minutes: 0 }], T0), T0, T0)).toBeUndefined()
})

test('the shared data file names files, never their folders', async () => {
  let d = newDesk('s1', 'CTO', T0)
  d = applyTool(d, 'Read', { file_path: '/home/sam/private/intro.md' }, 'k1', T0)
  d = applyTool(d, 'Edit', { file_path: '/home/sam/private/plan.md' }, 'k2', T0 + 1)
  const js = dataJs(T0, [d])
  expect(js.startsWith('window.__office && window.__office(')).toBe(true)
  expect(js.includes('intro.md')).toBe(true)
  expect(js.includes('/home/sam')).toBe(false)
  expect(d.activity).toBe('edit')
})

test('a helper walks in as an intern', async () => {
  const d = applyTool(newDesk('s1', 'CTO', T0), 'Agent', { description: 'Draw the office art', run_in_background: true }, 'k9', T0)
  expect(d.interns).toEqual([{ key: 'k9', label: 'Draw the office…', startMs: T0, background: true }])
})

test('ETA: one quick first step does not collapse a long plan', async () => {
  let steps = planSteps([10, 25, 10, 20].map((m, i) => ({ label: `S${i}`, minutes: m })), T0)
  steps = finishStep(steps, 1, T0 + 1 * MIN)
  const left = (eta(steps, T0, T0 + MIN)!.finishMs - T0 - MIN) / MIN
  expect(left > 45).toBe(true)
})

test('a teammate named CEO shows as CEO, whether it is addressed by name or by address', async () => {
  const got = parseReceived('<cross-session-message from="uds:/tmp/a.sock" from-name="mod-session-x">hi</cross-session-message>')
  expect(got.addr).toBe('uds:/tmp/a.sock')
  const d = { peers: { 'mod-session-x': 'CEO' }, seen: { [got.addr]: got.from } }
  expect(peerName(d, 'mod-session-x')).toBe('CEO')
  expect(peerName(d, 'uds:/tmp/a.sock')).toBe('CEO')
  expect(peerName(d, 'someone-else')).toBe('someone-else')
})

test('long or machine-made file names read as plain words', async () => {
  expect(activityOf('Read', { file_path: '/x/s02-plane-ceo-cto.png' })?.detail).toBe('Reading a screenshot')
  expect(activityOf('Edit', { file_path: '/x/intro.md' })?.detail).toBe('Editing intro.md')
  expect(activityOf('Read', { file_path: '/x/2026-10-11-claude-code-mods.md' })?.detail).toBe('Reading a doc')
})

test('a bubble keeps whole sentences', async () => {
  expect(firstWords('Final take of the office video is recording now. This note flies CTO to CEO.')).toBe('Final take of the office video is recording now.')
  expect(firstWords('Office v2 reviewed: privacy clean, all 5 fixes confirmed on my own contact sheet and a frame at 20s, and two small fixes remain before it can go to the writer today.')).toBe('Office v2 reviewed: privacy clean, all 5 fixes confirmed on my own contact sheet and a frame at 20s')
})
