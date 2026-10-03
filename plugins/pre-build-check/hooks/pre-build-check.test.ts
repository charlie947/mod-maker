import { expect, test } from 'claude-code/testing'

import { hasReference, isBuildPrompt, reminder } from './rules'

test('build prompts trigger, chat does not', () => {
  expect(isBuildPrompt('Build me a landing page for the webinar')).toBe(true)
  expect(isBuildPrompt('write the email to the client')).toBe(true)
  expect(isBuildPrompt('What time is it in New York?')).toBe(false)
  expect(isBuildPrompt('show me the report')).toBe(false)
})

test('the reminder names the rule files', () => {
  const r = reminder('build the pricing page', ['/proj/CLAUDE.md', '/home/sam/.claude/CLAUDE.md'])
  expect(r).toContain('/proj/CLAUDE.md')
  expect(r).toContain('not verified')
})

test('reference rule only when a reference is in play', () => {
  expect(hasReference('make a page like this https://example.com')).toBe(true)
  expect(reminder('make the page like this https://example.com', [])).toContain('REFERENCE RULE')
  expect(reminder('write the caption', [])).not.toContain('REFERENCE RULE')
})
