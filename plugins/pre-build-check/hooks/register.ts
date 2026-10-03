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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    const cwd = await $.session.cwd()
    const listed = (await $.env.get('PRE_BUILD_RULES')) ?? ''
    ruleFiles = await existing($, listed ? listed.split(':') : [`${cwd}/CLAUDE.md`, `${home}/.claude/CLAUDE.md`])
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (!isBuildPrompt(e.text)) return next(e)
    return next({ ...e, context: [...(e.context ?? []), reminder(e.text, ruleFiles)] })
  })
}
