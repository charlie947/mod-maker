// /mod-check: turns `claude plugin validate` output into plain English: what the mod can
// read, run and send. Pure, so the wording is tested.

const CALLS: [RegExp, string, 'read' | 'run' | 'send' | 'change'][] = [
  [/^\$\.fs\.(read|list|stat|exists)/, 'read files on your computer', 'read'],
  [/^\$\.fs\.(write|delete|remove|mkdir|move)/, 'write or change files on your computer', 'change'],
  [/^\$\.process\.(run|spawn)/, 'run programs on your computer', 'run'],
  [/^\$\.http\./, 'send and fetch data over the internet', 'send'],
  [/^\$\.model\./, 'call Claude by itself (this uses your plan or API credit)', 'send'],
  [/^\$\.mcp\./, 'call your connected MCP tools', 'send'],
  [/^\$\.prompt\.submit/, 'send prompts to Claude as if you typed them', 'send'],
  [/^\$\.prompt\.fill/, 'put text in your prompt box (you still press Enter)', 'change'],
  [/^\$\.session\.(send|compact|end)/, 'act on the session (send, compact or end it)', 'change'],
  [/^\$\.env\.set/, 'change environment variables', 'change'],
  [/^\$\.store\./, 'keep its own saved data between sessions', 'read'],
  [/^\$\.agent\./, 'start subagents', 'run'],
  [/^\$\.tool\.call/, 'use Claude Code tools by itself', 'run'],
]

const HOOKS: [RegExp, string][] = [
  [/^tool\.call\{tool=Bash/, 'see, block or change the shell commands Claude runs'],
  [/^tool\.call\{tool=/, 'see, block or change some of the tools Claude uses'],
  [/^tool\.call$/, 'see, block or change every tool Claude uses'],
  [/^tool\.check/, 'change what needs your permission'],
  [/^prompt\.submit/, 'read your prompts and add text to them'],
  [/^prompt\.compose/, "change Claude's system prompt"],
  [/^turn\.complete/, "read Claude's answers"],
  [/^ui\.render/, 'draw on your screen'],
  [/^command\.run/, 'answer its own slash commands'],
]

export type Check = { ok: boolean; lines: string[] }

export function explain(validateOut: string, sources: string[] = []): Check {
  const ok = /Validation passed/.test(validateOut)
  const grab = (label: string) =>
    validateOut
      .split('\n')
      .filter(l => l.includes(` ${label}: `))
      .flatMap(l => l.slice(l.indexOf(` ${label}: `) + label.length + 3).split(/,\s*(?![^{(]*[})])/))
      .map(s => s.trim())
      .filter(s => s && s !== 'nothing')

  const calls = grab('calls').map(c => c.replace(/\s*\(via .*\)$/, ''))
  const can = new Set<string>()
  for (const c of calls) for (const [re, says] of CALLS) if (re.test(c)) can.add(says)
  for (const h of grab('hooks')) for (const [re, says] of HOOKS) if (re.test(h)) { can.add(says); break }

  const reads = grab('env reads')
  const writes = grab('env writes')
  const urls = [...new Set(sources.flatMap(s => s.match(/https?:\/\/[^\s'"`)]+/g) ?? []))]

  const lines = [ok ? 'Validation passed.' : 'Validation FAILED. Do not install this mod until it passes.']
  lines.push('', 'This mod can:')
  if (can.size === 0) lines.push('  - nothing outside its own screen area')
  for (const s of can) lines.push(`  - ${s}`)
  if (reads.length) lines.push(`  - read these environment variables: ${reads.join(', ')}`)
  if (writes.length) lines.push(`  - set these environment variables: ${writes.join(', ')}`)
  const kinds = new Set(calls.flatMap(c => CALLS.filter(([re]) => re.test(c)).map(([, , k]) => k)))
  lines.push(
    '',
    kinds.has('send')
      ? 'It CAN send data off your machine. Read the code before you install it.'
      : kinds.has('run')
        ? 'It sends nothing by itself, but a program it runs could. Check which programs it runs.'
        : 'It cannot send anything off your machine.',
  )
  if (urls.length) lines.push(`Web addresses in its code: ${urls.join(', ')}`)
  return { ok, lines }
}
