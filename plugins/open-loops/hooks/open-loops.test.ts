import { expect, test } from 'claude-code/testing'

import { extractAsks } from './extract'

test('extract: real multi-ask prompt gives each ask', () => {
  const asks = extractAsks(
    "Okay, the client said the deck is too long. Is that possible to shorten? Did we create the invoice for Acme? Can we send the invoice to Globex? Can we fill in the form for the venue? Do anything else required.",
  )
  expect(asks).toEqual([
    'Is that possible to shorten?',
    'Did we create the invoice for Acme?',
    'Can we send the invoice to Globex?',
    'Can we fill in the form for the venue?',
    'Do anything else required.',
  ])
})

test('extract: bare approvals are not asks', () => {
  for (const p of ['Go', 'Send', 'ETA?', 'yes', 'Done!', 'Allow']) expect(extractAsks(p)).toEqual([])
})

test('extract: short real asks count', () => {
  expect(extractAsks('show me')).toEqual(['show me'])
  expect(extractAsks('fix it then')).toEqual(['fix it then'])
})

test('extract: long pasted job prompts are skipped', () => {
  expect(extractAsks('Lint the rows. '.repeat(400))).toEqual([])
})

test('add, close with proof, drop', async $ => {
  await $.tool.call({ tool: 'mcp__open-loops__add_loop', text: 'Send the Acme invoice' } as any)
  await $.tool.call({ tool: 'mcp__open-loops__add_loop', text: 'Not a real ask' } as any)
  const noProof: any = await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 1, proof: '' } as any)
  expect(String(noProof.result)).toContain('proof is required')
  await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 1, proof: 'Gmail sent id 123' } as any)
  await $.tool.call({ tool: 'mcp__open-loops__drop_loop', id: 2, reason: 'not an ask' } as any)
  const out: any = await ($ as any).command.run({ command: 'loops', args: '' })
  expect(String(out.text)).toContain('No open loops. 2 asks tracked')
  const missing: any = await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 9, proof: 'x' } as any)
  expect(String(missing.result)).toContain('No loop L9')
})

test('every item of a numbered list is an ask, whatever its verb', () => {
  expect(extractAsks('1. Count the rules in my-rules.md\n2. Add a fourth rule about dates\n3. Write a one-line summary to summary.md')).toEqual([
    'Count the rules in my-rules.md',
    'Add a fourth rule about dates',
    'Write a one-line summary to summary.md',
  ])
})

test('a numbered item with an unknown verb is still an ask', () => {
  expect(extractAsks('1. Inspect the logs\n2. Document the result')).toEqual(['Inspect the logs', 'Document the result'])
})
