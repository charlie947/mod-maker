// Pure-ish core of safe-delete. Every outside effect goes through `run` (argv, cwd) so the
// same code runs in the mod (via $.process.run) and in a real-file test (via child_process).

export type Run = (argv: string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export type Plan =
  | { kind: 'none' }
  | { kind: 'compound'; why: string }
  | { kind: 'rm'; args: string[] }
  | { kind: 'find'; argv: string[] }
  | { kind: 'git-clean'; argv: string[] }
export type Item = { from: string; to: string }
export type Receipt = { at: string; command: string; items: Item[]; undone?: boolean }

const META = /[;&|`$<>()\n]/

// Splits a simple shell command into words, honouring single and double quotes.
export function words(cmd: string): string[] | null {
  const out: string[] = []
  let cur = '', q: string | null = null, any = false
  for (const c of cmd.trim()) {
    if (q) { if (c === q) q = null; else cur += c; continue }
    if (c === '"' || c === "'") { q = c; any = true; continue }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue }
    cur += c
  }
  if (q) return null
  if (cur || any) out.push(cur)
  return out
}

const DELETE_WORD = /(^|\s|\/)(rm|unlink|rmdir)(\s|$)|\s-delete(\s|$)|git\s+clean\b/

const WRAPPERS = new Set(['sudo', 'command', 'nice', 'xargs', 'exec', 'time', 'env'])

// True when this one command (no ; | && in it) really is a delete, not text that mentions one.
function isDeleteSegment(seg: string): boolean {
  let w = seg.trim().split(/\s+/).filter(Boolean)
  while (w.length && (WRAPPERS.has(w[0]) || /^-/.test(w[0]) || /^\w+=/.test(w[0]))) w = w.slice(1)
  const head = (w[0] ?? '').split('/').pop()
  if (head === 'rm' || head === 'unlink' || head === 'rmdir') return true
  if (head === 'find' && w.includes('-delete')) return true
  return head === 'git' && w.includes('clean')
}

export function classify(cmd: string): Plan {
  if (!DELETE_WORD.test(cmd)) return { kind: 'none' }
  // Outside quotes, any control character means more than one command. Stop it only when
  // one of those commands really is a delete, so a heredoc that mentions "rm" still runs.
  const unquoted = cmd.replace(/'[^']*'|"[^"]*"/g, '')
  if (META.test(unquoted)) {
    return unquoted.split(/;|&&|\|\||\||\n|\$\(|`|\(/).some(isDeleteSegment)
      ? { kind: 'compound', why: 'the delete is part of a longer command' }
      : { kind: 'none' }
  }
  let w = words(cmd)
  if (!w || !w.length) return { kind: 'none' }
  while (w[0] === 'sudo' || w[0] === 'command' || w[0] === 'nice') w = w.slice(1)
  const head = w[0].split('/').pop()
  if (head === 'rm' || head === 'unlink' || head === 'rmdir') {
    const args: string[] = []
    let end = false
    for (const a of w.slice(1)) {
      if (!end && a === '--') { end = true; continue }
      if (!end && a.startsWith('-') && a.length > 1) continue
      args.push(a)
    }
    return { kind: 'rm', args }
  }
  if (head === 'find' && w.includes('-delete')) return { kind: 'find', argv: w }
  if (head === 'git' && w[1] === 'clean') return { kind: 'git-clean', argv: w }
  return { kind: 'none' } // e.g. `bash cleanup.sh`: a delete inside a script is NOT caught
}

// Keep only top-level paths: when a folder goes to the Bin, its contents go with it.
export function topLevel(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort()
  return sorted.filter(p => !sorted.some(q => q !== p && p.startsWith(q.endsWith('/') ? q : `${q}/`)))
}

// `missing` lists rm arguments that matched nothing: a sign the command assumed another folder.
export async function resolvePaths(plan: Plan, cwd: string, home: string, run: Run): Promise<{ paths: string[]; missing: string[] }> {
  if (plan.kind === 'rm') {
    const out: string[] = [], missing: string[] = []
    for (const raw of plan.args) {
      const a = raw === '~' ? home : raw.startsWith('~/') ? home + raw.slice(1) : raw
      // IFS is empty, so $1 is never split; left unquoted, only its glob characters expand.
      // Glob expansion runs no code, so the argument cannot execute anything.
      const e = await run(['/bin/sh', '-c', 'IFS=; for f in $1; do [ -e "$f" ] || [ -L "$f" ] && printf "%s\\0" "$f"; done', 'sh', a], cwd)
      const found = e.stdout.split('\0').filter(Boolean)
      if (!found.length) missing.push(raw)
      out.push(...found)
    }
    return { paths: out.map(p => (p.startsWith('/') ? p : `${cwd}/${p}`)), missing }
  }
  if (plan.kind === 'find') {
    const argv = plan.argv.filter(a => a !== '-delete').concat('-print0')
    const r = await run(argv, cwd)
    const paths = r.stdout.split('\0').filter(Boolean).map(p => (p.startsWith('/') ? p : `${cwd}/${p.replace(/^\.\//, '')}`))
    return { paths: paths.filter(p => p !== cwd && p !== `${cwd}/.`), missing: [] }
  }
  if (plan.kind === 'git-clean') {
    const argv = plan.argv.map(a => (/^-[a-zA-Z]+$/.test(a) ? a.replace(/f/g, '') : a)).filter(a => a !== '-' && a !== '--force')
    argv.splice(2, 0, '-n')
    const r = await run(argv, cwd)
    const paths = r.stdout
      .split('\n')
      .map(l => /^Would remove (.+)$/.exec(l)?.[1])
      .filter((p): p is string => !!p)
      .map(p => `${cwd}/${p.replace(/\/$/, '')}`)
    return { paths, missing: [] }
  }
  return { paths: [], missing: [] }
}

export async function moveToBin(paths: string[], bin: string, run: Run, stamp: string): Promise<Item[]> {
  const items: Item[] = []
  for (const from of topLevel(paths)) {
    const base = from.split('/').filter(Boolean).pop() ?? 'item'
    // Many files share a name (every folder's config.json): find a name nothing in the Bin
    // has yet, and use mv -n so a race can still never overwrite what is already there.
    let to = `${bin}/${base}`
    for (let n = 1; (await run(['/bin/test', '-e', to], '/')).exitCode === 0 || (await run(['/bin/test', '-L', to], '/')).exitCode === 0; n++) {
      to = `${bin}/${base} ${stamp}${n > 1 ? ` ${n}` : ''}`
    }
    const r = await run(['/bin/mv', '-n', '--', from, to], '/')
    if (r.exitCode === 0 && (await run(['/bin/test', '-e', from], '/')).exitCode === 0) continue // mv -n refused: left in place
    if (r.exitCode === 0) items.push({ from, to })
  }
  return items
}

export async function undo(receipt: Receipt, run: Run): Promise<{ back: Item[]; skipped: Item[] }> {
  const back: Item[] = [], skipped: Item[] = []
  for (const it of receipt.items) {
    const taken = (await run(['/bin/test', '-e', it.from], '/')).exitCode === 0
    if (taken) { skipped.push(it); continue }
    await run(['/bin/mkdir', '-p', it.from.split('/').slice(0, -1).join('/') || '/'], '/')
    const r = await run(['/bin/mv', '--', it.to, it.from], '/')
    ;(r.exitCode === 0 ? back : skipped).push(it)
  }
  return { back, skipped }
}

export function preview(items: Item[]): string {
  const first = items.slice(0, 10).map(i => `  ${i.from}`).join('\n')
  return `${items.length} item(s)${items.length > 10 ? ', first 10' : ''}:\n${first}`
}
