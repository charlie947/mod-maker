import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { audit, lastSessions, parseHistory, report } from './audit'
import type { Habit } from './audit'
import { explain } from './explain'
import { extractAsks } from './extract'
import { buildPrompt, track } from './habit'

// Mod Maker. Four parts:
//   /mod-audit        ranks what you ask again and again, from your own prompt history
//   /mod-build <n>    asks Claude to build a mod for habit n, with tests
//   /mod-check <dir>  says in plain English what a mod can read, run and send
//   habit spotter     the third time you ask the same thing in a session, offers to make it a mod

const groups = atom({ plugin: 'mod-maker', key: 'groups' } as const, [])
const offer = atom({ plugin: 'mod-maker', key: 'offer' } as const, null)

let home = ''
let sessionsToRead = 30
let historyPath = ''

async function runAudit($: any) {
  const text = await $.fs.read(historyPath).catch(() => '')
  if (!text) return null
  const r = audit(lastSessions(parseHistory(text), sessionsToRead))
  await $.store.set('audit', r.habits)
  return r
}

async function checkMod($: any, dir: string): Promise<string> {
  if (!dir) return 'Give the mod folder, for example /mod-check ~/my-mods/safe-delete'
  const path = dir.startsWith('~/') ? home + dir.slice(1) : dir
  const v = await $.process.run(['claude', 'plugin', 'validate', path], { timeoutMs: 60000 }).catch((err: unknown) => ({ stdout: '', stderr: String(err), exitCode: 1 }))
  const files: string[] = await $.fs.list(`${path}/hooks`).then((l: any[]) => l.map(f => (typeof f === 'string' ? f : f.name)), () => [])
  const sources: string[] = []
  for (const f of files) if (/\.(t|j)sx?$/.test(f)) sources.push(await $.fs.read(`${path}/hooks/${f.split('/').pop()}`).catch(() => ''))
  return [`Safety check for ${path}`, ...explain(`${v.stdout}\n${v.stderr}`, sources).lines].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    const n = Number(await $.env.get('MOD_AUDIT_SESSIONS'))
    if (n > 0) sessionsToRead = n
    historyPath = (await $.env.get('MOD_AUDIT_HISTORY')) ?? `${home}/.claude/history.jsonl`
    await $.command.register({ name: 'mod-audit', description: 'Rank what you ask Claude again and again, from your last 30 sessions' })
    await $.command.register({ name: 'mod-build', description: 'Build a mod for one habit from /mod-audit, e.g. /mod-build 2' })
    await $.command.register({ name: 'mod-check', description: 'Say in plain English what a mod can read, run and send, e.g. /mod-check ./my-mod' })
    await $.tool.register({
      name: 'check_mod',
      description: 'Safety check for a mod folder: runs claude plugin validate and returns, in plain English, what the mod can read, run and send. Show the result to the user.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string' } }, required: ['folder'] },
    })
    return next(e)
  })

  on('command.run', { command: 'mod-audit' }, async $ => {
    const r = await runAudit($)
    return { text: r ? report(r) : `No prompt history found at ${historyPath}.` }
  })

  on('command.run', { command: 'mod-build' }, async ($, e: any) => {
    const n = Number(String(e.args ?? '').trim())
    const habits = ((await $.store.get('audit')) as Habit[] | undefined) ?? (await runAudit($))?.habits ?? []
    const h = habits.find(x => x.n === n)
    if (!h) return { text: habits.length ? `Pick a number from 1 to ${habits.length}. Run /mod-audit to see the list.` : 'Run /mod-audit first.' }
    void $.prompt.submit({ text: buildPrompt(h) })
    return { text: `Building a mod for habit ${n}: "${h.phrase.replace(/^> /, '')}" (${h.count} times).` }
  })

  on('command.run', { command: 'mod-check' }, async ($, e: any) => ({ text: await checkMod($, String(e.args ?? '').trim()) }))

  on('tool.call', { tool: 'mcp__mod-maker__check_mod' }, async ($, e: any) => ({ result: await checkMod($, String(e.folder ?? '')) }))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'composer') {
      const asks = extractAsks(e.text)
      if (asks.length) {
        const r = track(await read($, groups), asks)
        await update($, groups, () => r.groups)
        if (r.hit) await update($, offer, () => r.hit)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const o = await read($, offer)
    if (!o) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const short = o.text.length > 70 ? `${o.text.slice(0, 69)}…` : o.text
    return (
      <Box flexDirection="row">
        <Text>
          You have asked this {o.count} times: "{short}". Make it a mod?{' '}
        </Text>
        <Button
          key="make"
          label="Make a mod"
          onPress={async () => {
            await update($, offer, () => null)
            await $.prompt.fill({ text: buildPrompt({ phrase: o.text, count: o.count, examples: o.examples }) })
          }}
        />
        <Button key="later" label="Not now" onPress={async () => update($, offer, () => null)} />
      </Box>
    )
  })
}
