import { expect, mock, test } from 'claude-code/testing'

import { register } from './register'
import { BRAND, bandFacts, elapsed, frame, meter, summary } from './theme'

// Stands in for Claude Code beneath the mod: a clock, and the engine's own drawing as one line.
const engine = (on: any) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', async ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['ENGINE DRAWING'] })
  })
}

const NO_ORANGE = /#D97557|orange/i

test('the palette is the website palette, with one signal colour and no orange', () => {
  expect(BRAND.canvas).toBe('#00132F')
  expect(BRAND.card).toBe('#0A2342')
  expect(BRAND.line).toBe('#1C3A5E')
  expect(BRAND.signal).toBe('#58B6FF')
  expect(NO_ORANGE.test(JSON.stringify(BRAND))).toBe(false)
})

test('helpers: time, frames, tool summary, band facts, meter', () => {
  expect([elapsed(4_200), elapsed(65_000), elapsed(-5)]).toEqual(['4s', '1m 05s', '0s'])
  expect([frame(0), frame(1), frame(4)]).toEqual(['◐', '◓', '◐'])
  expect(summary({ command: 'ls   -la\n src' })).toBe('ls -la src')
  expect(summary({ description: 'List files', command: 'ls' })).toBe('List files')
  expect(summary({})).toBe('')
  expect(bandFacts(3, 41.6)).toEqual(['3 OPEN LOOPS', 'CONTEXT 42%'])
  expect(bandFacts(1, undefined)).toEqual(['1 OPEN LOOP'])
  expect(bandFacts(undefined, 7)).toEqual(['CONTEXT 7%'])
  const m = meter(40)
  expect([m.full, m.empty]).toEqual(['████', '░░░░░░'])
})

test('a spinner with no word still says something', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'Spinner',
    props: { word: '', message: null, suffix: '…', mode: 'requesting' },
  } as any)
  expect(await ui.find({ type: 'Text', text: /^Working…$/ })).toBeDefined()
  await ui.unmount()
})

test('the spinner is drawn in the signal colour with the word in white', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'Spinner',
    props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
  } as any)
  const glyph = await ui.find({ type: 'Text', text: /^◐ $/ })
  expect(glyph?.props.color).toBe(BRAND.signal)
  const word = await ui.find({ type: 'Text', text: /^Thinking…$/ })
  expect(word?.props.color).toBe(BRAND.text)
  await ui.unmount()
})

test('a running tool row carries the signal colour and says what it is doing', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'ToolUse',
    props: { tool_use_id: 't1', tool: 'Bash', input: { description: 'List files' }, isRunning: true, isErrored: false, isInterrupted: false },
  } as any)
  expect((await ui.find({ type: 'Text', text: /^Bash$/ }))?.props.color).toBe(BRAND.signal)
  expect(await ui.find({ type: 'Text', text: /List files/ })).toBeDefined()
  await ui.unmount()
})

test('a finished or errored tool row keeps the engine drawing, so its result stays true', async ($, on) => {
  engine(on)
  for (const isErrored of [false, true]) {
    const ui = await $.ui.mount({
      plugin: 'brand-theme', surface: 'terminal', component: 'ToolUse',
      props: { tool_use_id: `t${isErrored}`, tool: 'Read', input: { file_path: 'a.md' }, isRunning: false, isErrored, isInterrupted: false, output: {} },
    } as any)
    expect(await ui.find({ type: 'Text', text: /ENGINE DRAWING/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▍/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the band shows the name and context used, sky on navy', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80 },
  } as any)
  const name = await ui.find({ type: 'Text', text: new RegExp(`^ ◆ ${BRAND.name} $`) })
  expect(name?.props.color).toBe(BRAND.signal)
  expect(name?.props.backgroundColor).toBe(BRAND.card)
  await ui.unmount()
})

test('the desktop app keeps its own look', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80 },
  } as any)
  expect(await ui.find({ type: 'Text', text: new RegExp(BRAND.name) })).toBeUndefined()
  await ui.unmount()
})

test('the question dialog keeps the engine dialog whole, with the header above it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('ui.render', async () => ({ type: 'engine', ref: 0 }) as any)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'AskUserQuestion',
    props: { tool: 'AskUserQuestion', questions: [] },
  } as any)
  expect((await ui.find({ type: 'Text', text: /^◆ YOUR CALL$/ }))?.props.color).toBe(BRAND.signal)
  await ui.unmount()
})

test('the band keeps what other mods draw in it, under the brand line', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'brand-theme', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80 },
  } as any)
  expect(await ui.find({ type: 'Text', text: new RegExp(`^ ◆ ${BRAND.name} $`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ENGINE DRAWING/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent finishing does not stop the main spinner', async () => {
  // Calls the hooks directly with a stand-in $, so the timer's cancel can be watched.
  const hooks: Record<string, any> = {}
  register(((name: string, ...args: any[]) => { hooks[name] = args.at(-1) }) as any, {} as any)
  let cancelled = 0
  const fake: any = {
    clock: { now: async () => 1000, every: () => ({ cancel: () => { cancelled++ } }) },
    state: { get: async () => ({ value: 0, version: 1 }), set: async () => ({ isSet: true, version: 2 }) },
    session: { usage: async () => ({}) },
  }
  const next = async (e: any) => e
  await hooks['turn.start'](fake, { turnId: 'main' }, next)
  await hooks['turn.complete'](fake, { turnId: 'child', agentId: 'a1' }, next)
  expect(cancelled).toBe(0)
  await hooks['turn.complete'](fake, { turnId: 'main' }, next)
  expect(cancelled).toBe(1)
})
