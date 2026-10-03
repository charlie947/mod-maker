import { expect, mock, test } from 'claude-code/testing'

import { extractAsks } from './asks'
import { applyTask, bar, clock, describe, finishStep, fromTodos, setPlan, tick } from './core'

// The engine's clock, answered by an in-memory clock that only moves when a test moves it.
const clockOf = (on: any) => mock.clock(on, { now: 1_000_000 })

test('feed lines are plain English with no tool names and no folder paths', () => {
  expect(describe('Read', { file_path: '/Users/sam/work/draft.md' })).toBe('Reading draft.md')
  expect(describe('Edit', { file_path: '/Users/sam/work/caption.txt' })).toBe('Editing caption.txt')
  expect(describe('Write', { file_path: '/tmp/a/plan.md' })).toBe('Writing plan.md')
  expect(describe('Bash', { command: 'npm test', description: 'run the tests' })).toBe('Run the tests')
  expect(describe('Bash', { command: 'ls' })).toBe('Running a command')
  expect(describe('WebFetch', { url: 'https:' + '//www.example.com/x' })).toBe('Reading a web page on example.com')
  expect(describe('mcp__notion__notion-fetch', {})).toBe('Using Notion: fetch')
  expect(describe('mcp__something__do_it', {})).toBe('Using a connected app: do it')
  for (const line of ['Read', 'Edit', 'Grep', 'Glob', 'Bash', 'Agent', 'SomethingNew'].map(t => describe(t, { file_path: '/Users/sam/x/y.md' }))) {
    expect(String(line).includes('/')).toBe(false)
    expect(/\b(Read|Edit|Grep|Glob|Bash|SomethingNew)\b/.test(String(line))).toBe(false)
  }
})

test('its own tools and lookups stay out of the feed', () => {
  expect(describe('mcp__mission-control__set_plan', {})).toBe(null)
  expect(describe('ToolSearch', {})).toBe(null)
})

test('a plan starts on step 1 and the bar fills as steps finish', () => {
  let steps = setPlan(['Write the tests', 'Build it', 'Record it'])
  expect(steps.map(s => s.status)).toEqual(['now', 'todo', 'todo'])
  expect(bar(steps, 12)).toEqual({ fill: '', empty: '░'.repeat(12), label: '0 of 3' })
  steps = finishStep(steps, 1)
  expect(steps.map(s => s.status)).toEqual(['done', 'now', 'todo'])
  steps = finishStep(finishStep(steps, 2), 3)
  expect(bar(steps, 12)).toEqual({ fill: '█'.repeat(12), empty: '', label: '3 of 3' })
})

test('a TodoWrite or Task list becomes the plan by itself', () => {
  expect(fromTodos([{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'pending' }]).map(s => s.status)).toEqual(['done', 'now', 'todo'])
  let steps = applyTask([], 'TaskCreate', { subject: 'A' })
  steps = applyTask(steps, 'TaskCreate', { subject: 'B' })
  steps = applyTask(steps, 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(steps).toEqual([{ label: 'A', status: 'done' }, { label: 'B', status: 'todo' }])
})

test('an ask ticks only by id, and the timer reads like a clock', () => {
  const asks = [{ id: 1, text: 'Send me the MP4', done: false }]
  expect(tick(asks, 2, 'x').found).toBe(false)
  const r = tick(asks, 1, '/tmp/out.mp4')
  expect(r.asks[0].done).toBe(true)
  expect(clock(9_400)).toBe('9s')
  expect(clock(83_000)).toBe('1m 23s')
})

test('asks come from what you typed, not from replies like "go"', () => {
  expect(extractAsks('Build the hero mod. Can you send me the MP4 path?')).toEqual(['Build the hero mod.', 'Can you send me the MP4 path?'])
  expect(extractAsks('go')).toEqual([])
})

test('a plan set through its tool shows on the panel state', async ($, on) => {
  clockOf(on)
  const r: any = await $.tool.call({ tool: 'mcp__mission-control__set_plan', steps: ['One', 'Two'] } as any)
  expect(String(r.result ?? '')).toContain('2 steps')
  const d: any = await $.tool.call({ tool: 'mcp__mission-control__step_done', step: 1 } as any)
  expect(String(d.result ?? '')).toContain('Step 1 done')
})

test('an ask from another session can be put on the panel and ticked with proof', async ($, on) => {
  clockOf(on)
  const a: any = await $.tool.call({ tool: 'mcp__mission-control__add_ask', text: 'Send me the MP4 path' } as any)
  expect(String(a.result ?? '')).toContain('is on the panel')
  const none: any = await $.tool.call({ tool: 'mcp__mission-control__tick_ask', id: 1, proof: '' } as any)
  expect(String(none.result ?? '')).toContain('proof is required')
})

test('the panel draws above the prompt with the plan, the feed and the asks', async ($, on) => {
  clockOf(on)
  on('ui.render', async () => null as any)
  await $.tool.call({ tool: 'mcp__mission-control__set_plan', steps: ['Copy it', 'Test it'] } as any)
  await $.tool.call({ tool: 'mcp__mission-control__add_ask', text: 'Add it to the pack' } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'mission-control', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 80 },
    } as any)
    expect(await ui.find({ type: 'Text', text: /MISSION CONTROL/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0 of 2 steps/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ Copy it/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Add it to the pack/ })).toBeDefined()
    await ui.unmount()
    const small = await $.ui.mount({
      plugin: 'mission-control', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 3, bodyColumns: 80 },
    } as any)
    expect(await small.find({ type: 'Text', text: /0 of 2/ })).toBeDefined()
    expect(await small.find({ type: 'Text', text: /ASKS 0\/1/ })).toBeDefined()
    await small.unmount()
  }
})

test('tool rows read in plain English, with no folder path and no tool name', async ($, on) => {
  clockOf(on)
  on('ui.render', async () => null as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const edit = await $.ui.mount({
      plugin: 'mission-control', surface, component: 'ToolUse',
      props: { tool_use_id: 't1', tool: 'Edit', input: { file_path: '/Users/sam/Documents/newsletter/intro.md' }, isRunning: false, isErrored: false, isInterrupted: false },
    } as any)
    expect(await edit.find({ type: 'Text', text: /Editing intro\.md/ })).toBeDefined()
    expect(await edit.find({ type: 'Text', text: /\/Users/ })).toBeUndefined()
    await edit.unmount()
    const plan = await $.ui.mount({
      plugin: 'mission-control', surface, component: 'ToolUse',
      props: { tool_use_id: 't2', tool: 'mcp__mission-control__set_plan', input: { steps: ['a', 'b', 'c'] }, isRunning: false, isErrored: false, isInterrupted: false },
    } as any)
    expect(await plan.find({ type: 'Text', text: /Plan: 3 steps/ })).toBeDefined()
    expect(await plan.find({ type: 'Text', text: /set_plan|MCP/ })).toBeUndefined()
    await plan.unmount()
    const early = await $.ui.mount({
      plugin: 'mission-control', surface, component: 'ToolUse',
      props: { tool_use_id: 't3', tool: 'mcp__mission-control__step_done', input: {}, isRunning: true, isErrored: false, isInterrupted: false },
    } as any)
    expect(await early.find({ type: 'Text', text: /Step done/ })).toBeDefined()
    expect(await early.find({ type: 'Text', text: /undefined/ })).toBeUndefined()
    await early.unmount()
  }
})
