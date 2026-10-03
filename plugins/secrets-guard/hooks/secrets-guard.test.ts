import { expect, test } from 'claude-code/testing'

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
