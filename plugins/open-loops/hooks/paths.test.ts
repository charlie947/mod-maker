import { expect, test } from 'claude-code/testing'

import { shortPaths } from './paths'

const txt = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(txt).join(' '))

test('paths in a proof are relative in the session folder and ~ in home', () => {
  const home = '/Users/sam'
  const cwd = '/Users/sam/mods-demo'
  expect(shortPaths('/Users/sam/mods-demo/hooks.md, 3 hooks', home, cwd)).toBe('hooks.md, 3 hooks')
  expect(shortPaths('saved to /Users/sam/Desktop/out.png', home, cwd)).toBe('saved to ~/Desktop/out.png')
  expect(shortPaths('file:///Users/sam/mods-demo/out/q3.html', home, cwd)).toBe('out/q3.html')
  expect(shortPaths('copied from /Users/other/x.md', home, cwd)).toBe('copied from ~/x.md')
  expect(shortPaths('https://example.com/a and intro.md', home, cwd)).toBe('https://example.com/a and intro.md')
})

test('the Open loops pane never shows a full home path in a proof', async ($, on) => {
  on('env.get', async () => ({ value: '/Users/sam' }) as any)
  on('session.cwd', async () => ({ value: '/Users/sam/mods-demo' }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('tool.register', async () => ({ value: undefined }) as any)
  on('ui.open', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }) as any)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }) as any)
  on('tool.call', async () => ({ result: 'ok' }) as any)

  await $.prompt.submit({ text: 'Write 3 LinkedIn hooks for the launch.' } as any)
  await $.tool.call({ tool: 'mcp__open-loops__close_loop', id: 1, proof: '/Users/sam/mods-demo/hooks.md (3 hooks)' } as any)
  const ui = await $.ui.mount({ plugin: 'open-loops', surface: 'terminal', component: 'Pane', props: {}, requestId: 'open-loops', viewport: { rows: 30, columns: 100 } } as any)
  const drawn = txt(await ui.drawn())
  expect(drawn).toContain('hooks.md')
  expect(drawn).not.toContain('/Users/')
  await ui.unmount()
})
