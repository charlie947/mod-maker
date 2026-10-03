import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { isVisual, visualPathsIn } from './paths'

// Opens the newest visual a turn made (a page, image, video or PDF) in its usual app,
// without stealing focus. macOS uses `open -g`, Linux uses `xdg-open`.
// /show brings the last one to the front.

const pending = atom({ plugin: 'show-it', key: 'pending' } as const, [])
const lastShown = atom({ plugin: 'show-it', key: 'lastShown' } as const, null)

const name = (p: string) => p.split('/').pop() ?? p

let home = ''
let turnStart = 0 // module values: a reload resets them, which is harmless here

let os = ''

async function show($: any, path: string, raise: boolean) {
  const argv = os === 'Darwin' ? ['open', ...(raise ? [] : ['-g']), path] : os === 'Linux' ? ['xdg-open', path] : null
  if (!argv) return false
  const r = await $.process.run(argv, { timeoutMs: 20000 }).catch(() => null)
  return r?.exitCode === 0
}

// Keep a path only when this turn wrote it, so a file merely read or listed never opens.
async function capture($: any, paths: string[]) {
  for (const p of paths) {
    const st = await $.fs.stat(p).catch(() => undefined)
    if (!st || st.kind !== 'file' || st.mtimeMs < turnStart - 2000) continue
    await update($, pending, list => [...(list ?? []).filter(x => x !== p), p])
  }
}


// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  home = (await $.env.get('HOME')) ?? home
  os = (await $.process.run(['uname', '-s']).catch(() => null))?.stdout.trim() ?? ''
  await $.command.register({ name: 'show', description: 'Bring the last page, image or video Claude made to the front' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    turnStart = await $.clock.now()
    return next(e)
  })

  on('tool.call', async ($, e: any, next) => {
    await setup($)
    const ran: any = await next(e)
    if (ran?.deny || ran?.isError) return ran
    if (e.tool === 'Write' || e.tool === 'Edit') {
      if (isVisual(String(e.file_path ?? ''))) await capture($, [e.file_path])
    } else if (e.tool === 'Bash') {
      const cwd = await $.session.cwd().catch(() => undefined)
      await capture($, visualPathsIn(`${String(e.command ?? '')}\n${ran?.text ?? ''}`, home, cwd))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await setup($)
    const list = await read($, pending)
    if (list.length > 0) {
      const newest = list[list.length - 1]
      await update($, pending, () => [])
      if (await show($, newest, false)) {
        await update($, lastShown, () => ({ path: newest, at: Date.now() }))
        $.ui.toast(`Opened ${name(newest)}. Type /show to bring it to the front.`)
        $.ui.status(`Last shown: ${name(newest)}`)
      } else {
        $.ui.toast(`Could not open ${newest}`)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'show' }, async $ => {
    await setup($)
    const last = await read($, lastShown)
    if (!last) return { text: 'Nothing shown yet in this session.' }
    const ok = await show($, last.path, true)
    return { text: ok ? `Brought to the front: ${last.path}` : `Could not open ${last.path}` }
  })
}
