import { expect, mock, test } from 'claude-code/testing'

// Four other sessions' cards on a faked fs, drawn by the real band over 10 seconds.
// It also prints each frame after FRAMESJSON, which is how the demo clip is made.
const txt = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(txt).join(' '))
test('a waiting session jumps to the top, says what it asks, and is named once', async ($, on) => {
  const T0 = 1_000_000
  const clk = mock.clock(on, { now: T0 })
  const toasts: string[] = []
  const cards: Record<string, any> = {
    a: { id: 'a', place: 'website', purpose: 'Build the pricing page', now: '', updatedMs: T0, state: 'running', startMs: T0 - 24_000 },
    b: { id: 'b', place: 'newsletter', purpose: "Draft Sunday's edition", now: '', updatedMs: T0, state: 'running', startMs: T0 - 23_000 },
    c: { id: 'c', place: 'reels', purpose: 'Cut the launch reel', now: '', updatedMs: T0 - 3_000, state: 'done', startMs: T0 - 9_000, endMs: T0 - 3_000 },
    d: { id: 'd', place: 'app', purpose: 'Ship the preview build', now: '', updatedMs: T0, state: 'running', startMs: T0 - 41_000 },
  }
  on('command.register', async () => ({ value: undefined }) as any)
  on('session.id', async () => ({ value: 'self' }) as any)
  on('env.get', async () => ({ value: '/home/demo' }) as any)
  on('session.cwd', async () => ({ value: '/home/demo/work' }) as any)
  on('fs.list', async (_$: any, e: any) => (seen.push('list'), { value: Object.keys(cards).map(k => ({ name: `${k}.json`, kind: 'file' })) }) as any)
  on('fs.read', async (_$: any, e: any) => ({ value: JSON.stringify(cards[String(e.path).split('/').pop()!.replace('.json', '')]) }) as any)
  on('fs.write', async () => ({}) as any)
  on('ui.toast', async (_$: any, e: any) => { toasts.push(String(e.text ?? JSON.stringify(e))); return {} as any })
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('tool.call', async () => ({ result: 'ok' }) as any)
  const seen: string[] = []
  const frames: any[] = []
  let t = 0
  const snap = async (label: string, ms: number) => {
    t += ms
    await clk.advance(ms)
    const ui = await $.ui.mount({ plugin: 'sessions-band', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 92 } } as any)
    frames.push({ t: t / 1000, label, tree: await ui.drawn(), toasts: [...toasts] })
    await ui.unmount()
  }
  await $.tool.call({ tool: 'Read', file_path: '/home/demo/x.md' } as any)
  for (let i = 0; i < 6; i++) await snap('running', i ? 500 : 0)
  cards.d = { ...cards.d, state: 'needs', waitingFor: 'Deploy to production', updatedMs: T0 + 2_500 }
  for (let i = 0; i < 8; i++) await snap('needs', 500)
  cards.a = { ...cards.a, state: 'done', endMs: T0 + 6_500, updatedMs: T0 + 6_500 }
  for (let i = 0; i < 6; i++) await snap('done', 500)
  console.log('FRAMESJSON' + JSON.stringify({ frames, toasts }))
  expect(frames.length).toBe(20)
  const first = txt(frames[0].tree), waiting = txt(frames[9].tree), last = txt(frames[19].tree)
  expect(first).toContain('3 working · 1 finished')
  expect(waiting.indexOf('your turn')).toBeLessThan(waiting.indexOf('working'))
  expect(waiting).toContain('asks: Deploy to production')
  expect(waiting).toContain('⚑ 1 waiting on you')
  expect(last).toContain('2 finished')
  expect(toasts).toEqual(['app is waiting on you: Deploy to production'])
})
