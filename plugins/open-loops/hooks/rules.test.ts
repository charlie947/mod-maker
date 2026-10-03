import { expect, test } from 'claude-code/testing'

import { extractAsks } from './extract'

// The prompt from a real desktop-app run: one task and four rules about how to do it.
const DEMO =
  'Work only in this demo folder. Make a four-step plan to tidy notes.txt and drafts, then do it. ' +
  'Preserve old-draft.md and .env. Do not read files outside this folder, contact anyone, install anything or publish.'

test('rules and limits are not logged as asks, the task is', () => {
  expect(extractAsks(DEMO)).toEqual(['Make a four-step plan to tidy notes.txt and drafts, then do it.'])
  expect(extractAsks("Don't change any setting. Never push to main. Keep the README unchanged. Fix the footer.")).toEqual(['Fix the footer.'])
  expect(extractAsks("Don't forget to send me the preview link.")).toEqual(["Don't forget to send me the preview link."])
})

test('before Claude stops, it is told once about asks from the last prompt it left open', async ($, on) => {
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }) as any)
  on('ui.open', async () => ({ value: undefined }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }) as any)
  on('tool.call', async () => ({ result: 'ok' }) as any)
  on('classic.Stop', async () => ({}) as any)

  await $.prompt.submit({ text: DEMO } as any)
  const first: any = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'All four steps are done.' } as any)
  expect(first.block).toContain('L1 "Make a four-step plan')
  expect(first.block).toContain('close_loop')
  expect(first.block).not.toContain('Do not read')

  // The retry after a block carries stop_hook_active, so the nudge never repeats.
  const retry: any = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Closed.' } as any)
  expect(retry.block).toBeUndefined()

  await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 1, proof: 'notes.txt tidied, drafts/ moved, old-draft.md and .env unchanged' } as any)
  const after: any = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' } as any)
  expect(after.block).toBeUndefined()
})
