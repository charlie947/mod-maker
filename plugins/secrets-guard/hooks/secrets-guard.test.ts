import { expect, test } from 'claude-code/testing'

import { checkValue, listKeys, setKey } from './envfile'
import { isSecretFile, maskKeys, secretCommand } from './secrets'

test('secret files are recognised, examples are not', () => {
  for (const p of ['.env', '/app/.env.local', '~/.ssh/id_ed25519', 'certs/server.pem', '/home/me/.aws/credentials', 'config/secrets.yml', '.npmrc'])
    expect(isSecretFile(p)).toBe(true)
  for (const p of ['.env.example', '/app/.env.sample', '~/.ssh/id_ed25519.pub', 'README.md', 'src/env.ts', 'keyboard.tsx'])
    expect(isSecretFile(p)).toBe(false)
})

test('commands that would print a secret are stopped', () => {
  expect(secretCommand('cat .env')).toContain('.env')
  expect(secretCommand('grep API_KEY /app/.env.production')).toContain('.env.production')
  expect(secretCommand('ls && tail -5 ~/.ssh/id_rsa')).toContain('id_rsa')
  expect(secretCommand('env')).toContain('every environment variable')
  expect(secretCommand('python app.py < .env')).toContain('.env')
})

test('ordinary commands pass', () => {
  for (const c of ['ls -la', 'cat README.md', 'cp .env.example .env', 'env NODE_ENV=test npm test', 'git status', 'grep -r "process.env" src'])
    expect(secretCommand(c)).toBe(null)
})

test('keys in output are masked', () => {
  const fake = 'sk-ant-' + 'a'.repeat(30)
  const r = maskKeys(`key is ${fake}\nOPENAI_API_KEY=abcdefgh12345678\nAWS AKIA${'A'.repeat(16)}`)
  expect(r.count).toBe(3)
  expect(r.text).not.toContain(fake)
  expect(r.text).toContain('OPENAI_API_KEY=[masked]')
  expect(r.text).toContain('sk-a…[masked]')
})

test('plain text is left alone', () => {
  const t = 'Built 12 mods. tokens used: 4000. password reset link sent.'
  expect(maskKeys(t)).toEqual({ text: t, count: 0 })
})

test('Claude cannot open a .env file', async $ => {
  const r: any = await $.tool.call({ tool: 'Read', file_path: '/tmp/project/.env' } as any)
  expect(String(r.deny)).toContain('holds secrets')
})

test('the .env pane lists names with masked values and writes a pasted key', () => {
  const text = 'MUX_TOKEN_ID=44c819de-1111-2222-3333-4d5e6f70492b\nSHORT=abc12345\n# note\nEMPTY=\n'
  expect(listKeys(text)).toEqual([
    { name: 'MUX_TOKEN_ID', masked: '●●●●492b' },
    { name: 'SHORT', masked: '●●●●●●●●' },
    { name: 'EMPTY', masked: '(empty)' },
  ])
  expect(setKey(text, 'SHORT', 'newvalue99')).toContain('SHORT=newvalue99\n')
  expect(setKey('A=1\n', 'B', 'two words')).toBe('A=1\nB="two words"\n')
  expect(checkValue('short', 8)).toContain('at least 8')
  expect(checkValue('a-long-enough-value', 8)).toBe(null)
})

test('a key pasted in the pane goes into .env, and Claude only hears that it is set', async ($, on) => {
  const disk: Record<string, string> = { '/fixture/.env': 'OPENAI_API_KEY=sk-test-000000000000000000001234\n' }
  const said: string[] = []
  on('fs.read', async (_$: any, e: any) => {
    if (!(e.path in disk)) throw new Error('missing')
    return { value: disk[e.path] } as any
  })
  on('fs.write', async (_$: any, e: any) => {
    disk[e.path] = String(e.text)
    return { value: undefined } as any
  })
  on('ui.render', async () => null as any)
  on('ui.open', async () => ({ value: { opened: true } }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('prompt.submit', async (_$: any, e: any) => {
    said.push(e.text)
    return { text: e.text } as any
  })
  const listed: any = await $.tool.call({ tool: 'mcp__secrets-guard__env_list', file: '/fixture/.env' } as any)
  expect(String(listed.result)).toContain('OPENAI_API_KEY  ●●●●1234')
  expect(String(listed.result)).not.toContain('sk-test')
  const asked: any = await $.tool.call({ tool: 'mcp__secrets-guard__env_request', key: 'MUX_TOKEN_ID', why: 'Uploads videos to Mux', where: ['Open Mux', 'Settings, then Access Tokens'], format: 'UUID, 36 characters', minLength: 36, file: '/fixture/.env' } as any)
  expect(String(asked.result)).toContain('wait')
  const ui = await $.ui.mount({ plugin: 'secrets-guard', surface: 'terminal', component: 'Pane', requestId: 'env', props: {}, viewport: { columns: 72, rows: 30 } } as any)
  expect(JSON.stringify(await ui.drawn())).toContain('Claude needs a value')
  await ui.input({ key: 'paste', text: 'too-short' })
  expect(JSON.stringify(await ui.drawn())).toContain('at least 36')
  const fake = '44c819de-aaaa-bbbb-cccc-4d5e6f70492b'
  await ui.input({ key: 'paste', text: fake })
  expect(disk['/fixture/.env']).toContain(`MUX_TOKEN_ID=${fake}`)
  expect(said).toEqual(['[env] MUX_TOKEN_ID is now set in .env. Continue.'])
  const after = JSON.stringify(await ui.drawn())
  expect(after).not.toContain(fake)
  expect(after).toContain('●●●●492b')
  await ui.unmount()
})
