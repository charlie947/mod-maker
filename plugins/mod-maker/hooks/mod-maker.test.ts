import { expect, test } from 'claude-code/testing'

import { audit, lastSessions, parseHistory, report } from './audit'
import { explain } from './explain'
import { buildPrompt, same, keyWords, track } from './habit'

const line = (display: string, sessionId: string, timestamp: number) => JSON.stringify({ display, sessionId, timestamp, project: '/p' })

const HISTORY = [
  line('Can you show me the screenshot?', 's1', 1),
  line('/clear', 's1', 2),
  line('Please run the tests again.', 's1', 3),
  line('show me the screenshot please', 's2', 4),
  line('Can you run the tests again?', 's2', 5),
  line('Where is it? Show me the screenshot.', 's3', 6),
  line('Run the tests again and fix what fails.', 's3', 7),
  line('Write a haiku about cats.', 's3', 8),
  '{"display": "half a line',
].join('\n')

test('reads history, skips slash commands and broken lines', () => {
  const e = parseHistory(HISTORY)
  expect(e.length).toBe(7)
  expect(e.some(x => x.text.startsWith('/'))).toBe(false)
})

test('keeps only the last N sessions', () => {
  const e = lastSessions(parseHistory(HISTORY), 2)
  expect(new Set(e.map(x => x.session))).toEqual(new Set(['s2', 's3']))
})

test('ranks repeat asks with real counts', () => {
  const r = audit(parseHistory(HISTORY))
  expect(r.sessions).toBe(3)
  const phrases = r.habits.map(h => h.phrase)
  expect(phrases).toEqual(['> show me the', '> run the tests']) // how the asks start, politeness removed
  const tests = r.habits.find(h => h.phrase === '> run the tests')!
  expect(tests.count).toBe(3)
  expect(tests.sessions).toBe(3)
  expect(phrases.join(' ')).not.toContain('haiku') // asked once is not a habit
  expect(report(r)).toContain('/mod-build')
})

test('an empty history says so instead of inventing habits', () => {
  expect(report(audit([]))).toContain('No ask came up 3 or more times')
})

test('the habit spotter fires on the third time, once', () => {
  let g = track([], ['Show me the screenshot']).groups
  g = track(g, ['can you show me the screenshot?']).groups
  const third = track(g, ['show me that screenshot please'])
  expect(third.hit?.count).toBe(3)
  const fourth = track(third.groups, ['show me the screenshot'])
  expect(fourth.hit).toBe(null)
})

test('different asks are not grouped', () => {
  expect(same(keyWords('run the tests'), keyWords('write the tests for login'))).toBe(false)
  expect(same(keyWords('push to GitHub'), keyWords('push it to github please'))).toBe(true)
})

test('the build prompt names the skill, the counts and the safety check', () => {
  const p = buildPrompt({ phrase: '> run the tests', count: 3, sessions: 3, examples: ['Run the tests again.'] })
  expect(p).toContain('plugin-authoring skill')
  expect(p).toContain('asks that start "run the tests…" (3 times across 3 sessions)')
  expect(p).toContain('claude plugin validate')
  expect(p).toContain('mcp__mod-maker__check_mod')
})

const VALIDATE = `Validating hooks: /x/hooks/hooks.json

  ❯ ./register.ts hooks: session.start, tool.call{tool=Bash}, command.run{command=undo-delete}
  ❯ ./register.ts calls: $.clock.now, $.fs.read (via readReceipts), $.fs.write (via writeReceipts), $.process.run
  ❯ ./register.ts env writes: nothing
  ❯ ./register.ts env reads: HOME, XDG_DATA_HOME

✔ Validation passed`

test('safety check in plain English: a mod that runs programs', () => {
  const t = explain(VALIDATE).lines.join('\n')
  expect(t).toContain('Validation passed.')
  expect(t).toContain('run programs on your computer')
  expect(t).toContain('write or change files')
  expect(t).toContain('see, block or change the shell commands')
  expect(t).toContain('HOME, XDG_DATA_HOME')
  expect(t).toContain('a program it runs could')
})

test('safety check flags a mod that sends data', () => {
  const v = '  ❯ ./r.ts hooks: prompt.submit\n  ❯ ./r.ts calls: $.http.fetch\n✔ Validation passed'
  const t = explain(v, ["fetch('https://example.com/collect')"]).lines.join('\n')
  expect(t).toContain('CAN send data off your machine')
  expect(t).toContain('https://example.com/collect')
  expect(t).toContain('read your prompts')
})

test('safety check says when validation failed', () => {
  expect(explain('✘ Validation failed: bad manifest').ok).toBe(false)
  expect(explain('✘ Validation failed').lines[0]).toContain('FAILED')
})
