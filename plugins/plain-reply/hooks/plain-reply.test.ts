import { expect, test } from 'claude-code/testing'

import { grade } from './grade'

const LONG = 'The hook reads the payload from stdout and writes it to the cache, then the middleware checks the schema against the endpoint before it retries the webhook with a backoff that follows the semver rules we set in the repo last week.'

test('a long sentence full of jargon is over the bar, with every reason named', () => {
  const g = grade(LONG)
  expect(g.over).toBe(true)
  expect(g.longest > 20).toBe(true)
  expect(g.jargon.length >= 3).toBe(true)
  expect(g.reasons.some(r => r.includes('sentence'))).toBe(true)
  expect(g.reasons.some(r => r.includes('jargon'))).toBe(true)
})

test('a short plain reply is under the bar', () => {
  const g = grade('Done. I saved the file. It opens in Chrome. Try it now.')
  expect([g.over, g.words, g.longest, g.jargon.length]).toEqual([false, 12, 4, 0])
})

test('code blocks do not count, and inline code is jargon unless it is a path', () => {
  const g = grade('Run this:\n```\nnpm install --save-dev some-very-long-package-name and more words here\n```\nThen open `~/Desktop/out.html` and set `maxWords`.')
  expect(g.words).toBe(8)
  expect(g.jargon).toEqual(['maxWords'])
})

test('list markers are not words', () => {
  expect(grade('1. Open it\n2. Press go').longest).toBe(2)
})

test('the bar comes from the options', () => {
  const g = grade('one two three four five six', { maxWords: 5, maxSentence: 20, maxJargon: 3 })
  expect([g.over, g.reasons]).toEqual([true, ['6 words']])
})

test('over the bar, the band offers Say it simpler and only drafts the request', async ($, on) => {
  let filled = ''
  let submitted = 0
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('classic.Stop', async () => ({}) as any)
  on('prompt.fill', async (_$: any, e: any) => { filled = e.text; return { isFilled: true } as any })
  on('prompt.submit', async (_$: any, e: any, next: any) => { submitted++; return next(e) })
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: LONG } as any)
  const ui = await $.ui.mount({ plugin: 'plain-reply', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90 } } as any)
  expect(JSON.stringify(await ui.drawn())).toContain('Say it simpler')
  await (ui as any).press({ key: 'simpler' })
  expect(filled).toBe('Rewrite that in 5 short sentences, no jargon.')
  expect(submitted).toBe(0)
  await ui.unmount()
})
