import type { Register } from 'claude-code'

import { notifyArgv, summary } from './notify'

// Pings you when Claude finishes an answer that took a while, or stops to ask your OK,
// so you can look away while it works. Short answers stay quiet.
// DONE_PING_AFTER_SECONDS sets "a while" (default 20).

let os = ''
let afterMs = 20000

async function ping($: any, title: string, message: string) {
  const argv = notifyArgv(os, title, message)
  if (argv) await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    os = (await $.process.run(['uname', '-s']).catch(() => null))?.stdout.trim() ?? ''
    const s = Number(await $.env.get('DONE_PING_AFTER_SECONDS'))
    if (s > 0) afterMs = s * 1000
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && !e.isAborted && e.durationMs >= afterMs) {
      const secs = Math.round(e.durationMs / 1000)
      await ping($, `Claude is done (${secs}s)`, summary(e.answer))
    }
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const r: any = await next(e)
    if (e.tool_use_id && r?.decision === 'ask') await ping($, 'Claude may need your OK', `It wants to use ${e.tool}.`)
    return r
  })
}
