import { expect, test } from 'claude-code/testing'

// The exact calls Claude made in a real -p run: list, two requests, a short paste, two good pastes.
// It also prints each drawn pane after FRAMESJSON, which is how the demo clip is made.
const txt = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(txt).join(' '))
test('Claude asks for two keys, a short paste is refused, and no value is ever shown', async ($, on) => {
  const env = (k: string) => 'process' + '.env.' + k // built at run time so no tool masks the sample
  const disk: Record<string, string> = { '/proj/src/upload.ts': `import Mux from '@mux/mux-node'\n\nconst mux = new Mux({ tokenId: ${env('MUX_TOKEN_ID')}, tokenSecret: ${env('MUX_TOKEN_SECRET')} })\n` }
  const said: string[] = []
  const toasts: string[] = []
  on('fs.read', async (_$: any, e: any) => { if (!(e.path in disk)) throw new Error('missing'); return { value: disk[e.path] } as any })
  on('fs.write', async (_$: any, e: any) => { disk[e.path] = String(e.text); return { value: undefined } as any })
  on('fs.list', async (_$: any, e: any) => {
    const kids = new Map<string, 'file' | 'dir'>()
    for (const k of Object.keys(disk)) if (k.startsWith(e.path + '/')) { const [h, ...t] = k.slice(e.path.length + 1).split('/'); kids.set(h, t.length ? 'dir' : 'file') }
    return { value: [...kids].map(([name, kind]) => ({ name, kind })) } as any
  })
  on('ui.render', async () => null as any)
  on('ui.open', async () => ({ value: { opened: true } }) as any)
  on('ui.toast', async (_$: any, e: any) => { toasts.push(String(e.text ?? e.message ?? '')); return { value: undefined } as any })
  on('prompt.submit', async (_$: any, e: any) => { said.push(e.text); return { text: e.text } as any })
  const listed: any = await $.tool.call({ tool: 'mcp__secrets-guard__env_list', file: '/proj/.env' } as any)
  const reqs = [{"key": "MUX_TOKEN_ID", "why": "Mux access token ID \u2014 lets src/upload.ts create video assets in your Mux account.", "link": "https://dashboard.mux.com/settings/access-tokens", "where": ["Open Mux dashboard \u2192 Settings \u2192 Access Tokens", "Click 'Generate new token', pick the environment, tick Mux Video (Read + Write)", "Copy the 'Access Token ID'"], "format": "UUID, 36 characters", "minLength": 36}, {"key": "MUX_TOKEN_SECRET", "why": "Mux secret key \u2014 pairs with MUX_TOKEN_ID to authenticate uploads.", "link": "https://dashboard.mux.com/settings/access-tokens", "where": ["Same token screen as MUX_TOKEN_ID", "Copy the 'Secret Key' \u2014 Mux shows it only once, at creation"], "format": "Long base64-style string", "minLength": 20}]
  const mount = () => $.ui.mount({ plugin: 'secrets-guard', surface: 'terminal', component: 'Pane', requestId: 'env', props: {}, viewport: { columns: 64, rows: 30 } } as any)
  const frames: any[] = []
  let ui = await mount()
  frames.push({ label: 'list', tree: await ui.drawn() })
  for (const r of reqs) await $.tool.call({ tool: 'mcp__secrets-guard__env_request', ...r, file: '/proj/.env' } as any)
  frames.push({ label: 'card', tree: await ui.drawn() })
  await ui.input({ key: 'paste', text: '3f2a9c1e-7b4d' })
  frames.push({ label: 'short', tree: await ui.drawn() })
  await ui.input({ key: 'paste', text: '3f2a9c1e-7b4d-4e8a-9c10-5d6e7f80a41c' })
  frames.push({ label: 'second', tree: await ui.drawn() })
  await ui.input({ key: 'paste', text: 'Zm9vYmFyYmF6cXV4ZmFrZXNlY3JldA' })
  frames.push({ label: 'saved', tree: await ui.drawn() })
  console.log('FRAMESJSON' + JSON.stringify({ frames, listed: listed.result, said, toasts }))
  expect(frames.length).toBe(5)
  expect(String(listed.result)).toContain('MUX_TOKEN_ID')
  expect(String(listed.result)).toContain('MUX_TOKEN_SECRET')
  const all = frames.map(f => txt(f.tree)).join(' | ')
  expect(all).not.toContain('3f2a9c1e-7b4d-4e8a-9c10-5d6e7f80a41c')
  expect(all).not.toContain('Zm9vYmFyYmF6cXV4ZmFrZXNlY3JldA')
  expect(said.join(' ')).not.toContain('3f2a9c1e')
  expect(disk['/proj/.env']).toContain('MUX_TOKEN_ID=3f2a9c1e-7b4d-4e8a-9c10-5d6e7f80a41c')
})
