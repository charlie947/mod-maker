import { expect, test } from 'claude-code/testing'

import { notifyArgv, summary } from './notify'

test('macOS notification with a sound', () => {
  const a = notifyArgv('Darwin', 'Claude is done (42s)', 'Built the report')!
  expect(a[0]).toBe('osascript')
  expect(a[2]).toContain('sound name "Glass"')
  expect(a[2]).toContain('Built the report')
})

test('Linux uses notify-send, other systems stay quiet', () => {
  expect(notifyArgv('Linux', 't', 'm')).toEqual(['notify-send', '--app-name=Claude Code', 't', 'm'])
  expect(notifyArgv('Windows_NT', 't', 'm')).toBe(null)
})

test('quotes in the answer cannot break out of the AppleScript string', () => {
  const a = notifyArgv('Darwin', 'x', 'He said "hi" \\ bye')!
  expect(a[2]).toContain("He said 'hi' ' bye")
})

test('summary is the first real line of the answer', () => {
  expect(summary('\n## **Done.** All 12 tests pass\nmore')).toBe('Done. All 12 tests pass')
  expect(summary('')).toBe('Claude finished.')
})
