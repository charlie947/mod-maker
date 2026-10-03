import type { Register } from 'claude-code'

import { isBuildPrompt, reminder } from './rules'

// Fixes "you ignored my rules" and "don't copy it". On any build prompt, Claude is told to
// re-read your rules first. Rule files: PRE_BUILD_RULES (colon-separated paths), else the
// project's CLAUDE.md and your ~/.claude/CLAUDE.md, whichever exist.

let ruleFiles: string[] = []

async function existing($: any, paths: string[]) {
  const out: string[] = []
  for (const p of paths) if (await $.fs.exists(p).catch(() => false)) out.push(p)
  return out
}

// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const listed = (await $.env.get('PRE_BUILD_RULES')) ?? ''
  ruleFiles = await existing($, listed ? listed.split(':') : [`${cwd}/CLAUDE.md`, `${home}/.claude/CLAUDE.md`])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await setup($)
    if (!isBuildPrompt(e.text)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), reminder(e.text, ruleFiles)] })
  })
}
