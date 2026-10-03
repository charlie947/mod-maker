import { expect, mock, test } from 'claude-code/testing'

import { shortPath } from './core'

const HOME = '/Users/sam'
const CWD = '/Users/sam/mods-demo'

test('a path on screen is relative in the session folder and ~ in home', () => {
  expect(shortPath('/Users/sam/mods-demo/old-draft.md', HOME, CWD)).toBe('old-draft.md')
  expect(shortPath('/Users/sam/Desktop/a.md', HOME, CWD)).toBe('~/Desktop/a.md')
  expect(shortPath('/Users/sam/.claude/safe-delete/receipts.jsonl', HOME)).toBe('~/.claude/safe-delete/receipts.jsonl')
  expect(shortPath('/Users/other/x.md', HOME, CWD)).toBe('~/x.md')
  expect(shortPath('/tmp/x.log', HOME, CWD)).toBe('/tmp/x.log')
})

test('the delete message and /undo-delete never print a full home path', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-03T18:15:25.539Z') })
  const exists = new Set([`${CWD}/old-draft.md`])
  let receipts = ''
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? HOME : undefined }) as any)
  on('session.cwd', async () => ({ value: CWD }) as any)
  on('command.register', async () => ({ value: undefined }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('fs.read', async () => ({ value: receipts }) as any)
  on('fs.write', async (_$: any, e: any) => { receipts = String(e.content ?? e.text ?? e.data ?? ''); return { value: undefined } as any })
  on('process.run', async (_$: any, e: any) => {
    const a: string[] = e.argv ?? []
    const ok = (b: boolean) => ({ value: { exitCode: b ? 0 : 1, stdout: '', stderr: '' } }) as any
    if (a[0] === 'uname') return { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '' } } as any
    if (a[0] === '/bin/sh') {
      const f = a[a.length - 1]
      return { value: { exitCode: 0, stdout: exists.has(`${CWD}/${f}`) ? `${f}\0` : '', stderr: '' } } as any
    }
    if (a[0] === '/bin/test') return ok(exists.has(a[2]))
    if (a[0] === '/bin/mv') { const [from, to] = a.slice(-2); exists.delete(from); exists.add(to); return ok(true) }
    return ok(true)
  })
  on('tool.call', async () => ({ result: 'ok' }) as any)

  const moved: any = await $.tool.call({ tool: 'Bash', command: 'rm old-draft.md' } as any)
  const said = String(moved.text ?? moved.deny ?? '')
  expect(said).toContain('old-draft.md')
  expect(said).toContain('~/.claude/safe-delete/receipts.jsonl')
  expect(said).not.toContain('/Users/')

  const back: any = await ($.command as any).run({ command: 'undo-delete', args: '' })
  expect(back.text).toContain('Put back 1 item(s)')
  expect(back.text).toContain('  old-draft.md')
  expect(back.text).not.toContain('/Users/')
  expect(exists.has(`${CWD}/old-draft.md`)).toBe(true)
})
