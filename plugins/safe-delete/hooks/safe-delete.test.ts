import { expect, test } from 'claude-code/testing'

import { classify, moveToBin, preview, resolvePaths, undo } from './core'
import type { Run } from './core'

test('catches rm', () => {
  expect(classify('rm notes.txt')).toEqual({ kind: 'rm', args: ['notes.txt'] })
})

test('catches rm -r', () => {
  expect(classify('rm -r old-folder')).toEqual({ kind: 'rm', args: ['old-folder'] })
})

test('catches rm -rf with quoted paths and --', () => {
  expect(classify('rm -rf -- "my folder" /tmp/x')).toEqual({ kind: 'rm', args: ['my folder', '/tmp/x'] })
  expect(classify('sudo rm -rf build')).toEqual({ kind: 'rm', args: ['build'] })
})

test('catches find -delete', () => {
  const p = classify("find . -name '*.log' -delete")
  expect(p.kind).toBe('find')
})

test('catches git clean', () => {
  expect(classify('git clean -fd').kind).toBe('git-clean')
})

test('stops a delete inside a longer command and asks for it alone', () => {
  for (const c of ['cd out && rm -rf build', 'rm a; rm b', 'ls | xargs rm', 'rm $(cat list)']) {
    expect(classify(c).kind).toBe('compound')
  }
})

test('does NOT claim to catch a delete inside a script', () => {
  expect(classify('bash cleanup.sh')).toEqual({ kind: 'none' })
  expect(classify('./scripts/reset.sh')).toEqual({ kind: 'none' })
  expect(classify('npm run clean')).toEqual({ kind: 'none' })
})

test('text that only mentions a delete is not stopped', () => {
  expect(classify("cat > notes.md <<'EOF'\nUse rm, find -delete and git clean with care\nEOF").kind).toBe('none')
  expect(classify('echo "git clean is risky" && ls').kind).toBe('none')
})

test('leaves normal commands alone', () => {
  for (const c of ['ls -la', 'git status', 'echo "rm is a word"', 'grep -r rmdir .']) {
    expect(classify(c).kind === 'rm').toBe(false)
  }
})

// A fake file system: a Set of paths, driven through the same Run interface the mod uses.
function fakeFs(files: string[]) {
  const fs = new Set(files)
  const run: Run = async argv => {
    const [cmd, ...a] = argv
    if (cmd === '/bin/test') return { exitCode: a[0] === '-e' && fs.has(a[1]) ? 0 : 1, stdout: '', stderr: '' }
    if (cmd === '/bin/mkdir') return { exitCode: 0, stdout: '', stderr: '' }
    if (cmd === '/bin/mv') {
      const [from, to] = a.filter(x => x !== '-n' && x !== '--')
      if (fs.has(to)) return { exitCode: 0, stdout: '', stderr: '' } // mv -n: silently skips
      if (!fs.has(from)) return { exitCode: 1, stdout: '', stderr: 'no such file' }
      fs.delete(from)
      fs.add(to)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    return { exitCode: 1, stdout: '', stderr: 'unexpected' }
  }
  return { fs, run }
}

test('moves to the Bin, writes a preview, and undo puts it back', async () => {
  const { fs, run } = fakeFs(['/p/a.txt', '/p/b.txt', '/bin-dir/a.txt'])
  const items = await moveToBin(['/p/a.txt', '/p/b.txt'], '/bin-dir', run, 'STAMP')
  expect(items).toEqual([
    { from: '/p/a.txt', to: '/bin-dir/a.txt STAMP' }, // name clash in the Bin gets a stamp
    { from: '/p/b.txt', to: '/bin-dir/b.txt' },
  ])
  expect(fs.has('/p/a.txt')).toBe(false)
  expect(preview(items)).toContain('2 item(s)')
  const { back, skipped } = await undo({ at: 'now', command: 'rm a b', items }, run)
  expect(back.length).toBe(2)
  expect(skipped.length).toBe(0)
  expect(fs.has('/p/a.txt') && fs.has('/p/b.txt')).toBe(true)
})

test('same-name files never overwrite each other in the Bin', async () => {
  const { fs, run } = fakeFs(['/a/config.json', '/b/config.json', '/c/config.json'])
  const items = await moveToBin(['/a/config.json', '/b/config.json', '/c/config.json'], '/bin-dir', run, 'S')
  expect(items.map(i => i.to)).toEqual(['/bin-dir/config.json', '/bin-dir/config.json S', '/bin-dir/config.json S 2'])
  expect([...fs].filter(p => p.startsWith('/bin-dir/')).length).toBe(3)
})

test('no argument ever carries a NUL byte (a real process refuses it)', async () => {
  const seen: string[] = []
  const run: Run = async argv => {
    seen.push(...argv)
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  await resolvePaths({ kind: 'rm', args: ['a.txt'] }, '/p', '/home/sam', run)
  expect(seen.length > 0).toBe(true)
  expect(seen.some(a => a.includes('\0'))).toBe(false)
})

test('undo never overwrites a file that now sits at the old path', async () => {
  const { run } = fakeFs(['/p/a.txt', '/bin-dir/a.txt'])
  const { back, skipped } = await undo({ at: 'now', command: 'rm a', items: [{ from: '/p/a.txt', to: '/bin-dir/a.txt' }] }, run)
  expect(back.length).toBe(0)
  expect(skipped.length).toBe(1)
})

test('a compound delete is denied before anything runs', async $ => {
  const r: any = await $.tool.call({ tool: 'Bash', command: 'cd out && rm -rf build' } as any)
  expect(String(r.deny ?? r.result ?? '')).toContain('Nothing was deleted')
})
