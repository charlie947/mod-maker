import { expect, test } from 'claude-code/testing'

// A 3-ask prompt, then two asks closed with proof: the band counts them and ticks only those two.
// It also prints each drawn frame after FRAMESJSON, which is how the demo clip is made.
const txt = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(txt).join(' '))
test('the band says how many asks it heard and ticks each one only with proof', async ($, on) => {
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('ui.open', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }) as any)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }) as any)
  on('tool.call', async () => ({ result: 'ok' }) as any)
  const frames: any[] = []
  const snap = async (label: string) => {
    const ui = await $.ui.mount({ plugin: 'open-loops', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 92 } } as any)
    frames.push({ label, tree: await ui.drawn() })
    await ui.unmount()
  }
  await snap('empty')
  await $.prompt.submit({ text: 'Shorten the intro to three lines. Can you add the pricing table under it? And send me the preview link when it is done.' } as any)
  await snap('heard')
  await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 1, proof: 'intro.md, 3 lines' } as any)
  await snap('one-done')
  await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 2, proof: 'pricing table at line 14' } as any)
  await snap('two-done')
  console.log('FRAMESJSON' + JSON.stringify({ frames }))
  const at = (label: string) => txt(frames.find(f => f.label === label).tree)
  expect(at('empty')).not.toContain('I heard')
  expect(at('heard')).toContain('I heard 3 asks')
  expect(at('heard')).toContain('Shorten the intro')
  expect(at('heard')).toContain('send me the preview link')
  expect(at('one-done')).toContain('intro.md, 3 lines')
  expect((at('two-done').match(/✓/g) ?? []).length).toBe(2)
})
