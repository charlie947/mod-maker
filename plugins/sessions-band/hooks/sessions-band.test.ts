import { expect, test } from 'claude-code/testing'

import { liveOthers, updateCard } from './cards'

test('first prompt sets the purpose, later prompts update "now" only', () => {
  const a = updateCard(null, 's1', '/Users/x/Desktop/website', 'Write the launch email <system-reminder>noise</system-reminder>', 1000)
  expect(a.place).toBe('website')
  expect(a.purpose).toBe('Write the launch email')
  const b = updateCard(a, 's1', '/Users/x/Desktop/website', 'Fix the title', 2000)
  expect([b.purpose, b.now, b.updatedMs]).toEqual(['Write the launch email', 'Fix the title', 2000])
})

test('the band leaves out this session and silent ones, newest first', () => {
  const c = (id: string, t: number) => ({ id, place: id, purpose: '', now: '', updatedMs: t })
  const now = 100 * 60e3
  expect(liveOthers([c('self', now), c('old', now - 20 * 60e3), c('a', now - 60e3), c('b', now - 5e3)], 'self', now).map(x => x.id)).toEqual(['b', 'a'])
})

test('a prompt that is only tags never blanks the card, and a later real prompt sets the purpose', () => {
  const a = updateCard(null, 's1', '/Users/x/work', '<cross-session-message from="x">hello</cross-session-message>', 1000)
  expect(a.purpose).toBe('')
  const b = updateCard(a, 's1', '/Users/x/work', 'Build the pricing page', 2000)
  expect([b.purpose, b.now]).toEqual(['Build the pricing page', 'Build the pricing page'])
  const c = updateCard(b, 's1', '/Users/x/work', '<system-reminder>x</system-reminder>', 3000)
  expect([c.purpose, c.now]).toEqual(['Build the pricing page', 'Build the pricing page'])
})
