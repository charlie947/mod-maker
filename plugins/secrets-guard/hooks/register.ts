import type { Register } from 'claude-code'

import { isSecretFile, maskKeys, secretCommand } from './secrets'

// Keeps keys out of the chat. Claude cannot open .env, SSH keys, .pem files or credential
// files, cannot run commands that print them, and any key that still shows up in a
// command's output is masked before Claude reads it.
// LIMIT: it masks command output, not the text of ordinary files Claude reads.

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])

export const register: Register = on => {
  on('tool.call', async ($, e: any, next) => {
    if (FILE_TOOLS.has(e.tool)) {
      const p = String(e.file_path ?? e.notebook_path ?? '')
      if (isSecretFile(p)) {
        $.ui.toast(`Stopped Claude opening ${p.split('/').pop()}`)
        return { deny: `secrets-guard: ${p} holds secrets, so Claude may not open it. If a value is needed, ask the user to put it in the right place themselves, or to name the variable without its value.` }
      }
      return next(e)
    }
    if (e.tool === 'Grep' && isSecretFile(String(e.path ?? ''))) {
      return { deny: `secrets-guard: ${e.path} holds secrets, so Claude may not search inside it.` }
    }
    if (e.tool !== 'Bash') return next(e)

    const why = secretCommand(String(e.command ?? ''))
    if (why) {
      $.ui.toast('Stopped a command that would print a secret')
      return { deny: `secrets-guard: ${why}. Use the variable by name instead (for example "$API_KEY" inside the command) so its value never reaches the chat.` }
    }
    const ran: any = await next(e)
    if (!ran?.result || typeof ran.result !== 'object') return ran
    const out = maskKeys(String(ran.result.stdout ?? ''))
    const err = maskKeys(String(ran.result.stderr ?? ''))
    if (out.count + err.count === 0) return ran
    $.ui.toast(`Masked ${out.count + err.count} key(s) in command output`)
    return { result: { ...ran.result, stdout: out.text, stderr: err.text } }
  })
}
