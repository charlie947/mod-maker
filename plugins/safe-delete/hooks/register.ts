import type { Register } from 'claude-code'

import { classify, moveToBin, preview, resolvePaths, shortPath, undo } from './core'
import type { Receipt, Run } from './core'

// Claude never deletes a file for good. A delete Claude runs (rm, rm -r, rm -rf, unlink,
// rmdir, find -delete, git clean) is stopped; the files go to the Bin instead, a receipt is
// written, and /undo-delete puts the last batch back.
// HONEST LIMIT: it catches delete commands Claude runs itself. A delete hidden inside a
// script Claude runs (bash cleanup.sh), or one you run yourself, is NOT caught.

let home = ''
let bin = ''
let receipts = ''

function runner($: any): Run {
  return async (argv, cwd) => {
    const r = await $.process.run(argv, { cwd, timeoutMs: 60000 }).catch(() => null)
    return r ?? { exitCode: 1, stdout: '', stderr: 'failed to run' }
  }
}

async function readReceipts($: any): Promise<Receipt[]> {
  const text = await $.fs.read(receipts).catch(() => '')
  return text.split('\n').filter(Boolean).map((l: string) => JSON.parse(l))
}

async function writeReceipts($: any, list: Receipt[]) {
  await $.fs.write(receipts, list.map(r => JSON.stringify(r)).join('\n') + '\n')
}

// Setup runs once: at session start or, after /reload-plugins (which does not fire
// session.start), on the first prompt or tool call.
let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  home = (await $.env.get('HOME')) ?? ''
  const os = (await $.process.run(['uname', '-s']).catch(() => null))?.stdout.trim() ?? ''
  const xdg = (await $.env.get('XDG_DATA_HOME')) ?? `${home}/.local/share`
  bin = os === 'Darwin' ? `${home}/.Trash` : os === 'Linux' ? `${xdg}/Trash/files` : ''
  receipts = `${home}/.claude/safe-delete/receipts.jsonl`
  await $.command.register({ name: 'undo-delete', description: 'Put the last batch of files safe-delete moved to the Bin back where they were' })
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e: any, next) => {
    await setup($)
    const command = String(e.command ?? '')
    const plan = classify(command)
    if (plan.kind === 'none') return next(e)
    if (plan.kind === 'compound') {
      return { deny: `safe-delete stopped this: ${plan.why}. Run the delete as its own command (for example rm path/to/file) so it can go to the Bin. Nothing was deleted.` }
    }
    if (!bin) return { deny: 'safe-delete stopped this: no Bin folder on this system (only macOS and Linux). Nothing was deleted. Ask the user to delete it by hand.' }

    const cwd = await $.session.cwd()
    const run = runner($)
    const { paths, missing } = await resolvePaths(plan, cwd, home, run)
    if (missing.length) {
      return { deny: `safe-delete stopped this: ${missing.join(', ')} not found from ${shortPath(cwd, home) || cwd}. Run it again with full paths (starting with /). Nothing was deleted.` }
    }
    if (!paths.length) return { deny: 'safe-delete: nothing matched, so nothing was moved or deleted.' }

    const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
    await run(['/bin/mkdir', '-p', bin, receipts.slice(0, receipts.lastIndexOf('/'))], '/')
    const items = await moveToBin(paths, bin, run, stamp)
    const list = await readReceipts($)
    list.push({ at: new Date(await $.clock.now()).toISOString(), command, items })
    await writeReceipts($, list.slice(-200))
    $.ui.toast(`Moved ${items.length} item(s) to the Bin. /undo-delete puts them back.`)
    return {
      deny: `safe-delete moved ${preview(items, home, cwd)}\nto the Bin instead of deleting them. Receipt: ${shortPath(receipts, home)}. The user can type /undo-delete to put them back. Treat the delete as done.`,
    }
  })

  on('command.run', { command: 'undo-delete' }, async $ => {
    await setup($)
    const cwd = await $.session.cwd().catch(() => undefined)
    const at = (p: string) => shortPath(p, home, cwd)
    const list = await readReceipts($)
    const last = [...list].reverse().find(r => !r.undone)
    if (!last) return { text: 'Nothing to undo: no batch is waiting in the receipts.' }
    const { back, skipped } = await undo(last, runner($))
    last.undone = true
    await writeReceipts($, list)
    const lines = [`Put back ${back.length} item(s) from ${last.at}:`, ...back.slice(0, 10).map(i => `  ${at(i.from)}`)]
    if (skipped.length) lines.push(`Left in the Bin (something already at that path): ${skipped.map(i => at(i.from)).join(', ')}`)
    return { text: lines.join('\n') }
  })
}
