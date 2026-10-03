import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EnvRequest } from '../types'
import { checkValue, CODE_FILE, KEY_NAME, listKeys, missingKeys, readsIn, setKey } from './envfile'
import { isSecretFile, maskKeys, secretCommand } from './secrets'

// Keeps keys out of the chat. Claude cannot open .env, SSH keys, .pem files or credential
// files, cannot run commands that print them, and any key that still shows up in a
// command's output is masked before Claude reads it.
// It also gives Claude a safe way to USE a key: env_list shows key names with masked values,
// and env_request opens a pane where you paste the value. The value goes straight into .env.
// Claude only ever hears "KEY is now set".
// LIMIT: it masks command output, not the text of ordinary files Claude reads.

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const PANE = 'env'
const ENV_HINT = 'To see which keys exist, call env_list. To get a missing key, call env_request: the user pastes it into a pane and it goes straight into .env.'

const requests = atom({ plugin: 'secrets-guard', key: 'requests' } as const, []) // first one shows, the rest wait their turn
const keys = atom({ plugin: 'secrets-guard', key: 'keys' } as const, [])
const fileAtom = atom({ plugin: 'secrets-guard', key: 'file' } as const, '.env')
const error = atom({ plugin: 'secrets-guard', key: 'error' } as const, '')
const missing = atom({ plugin: 'secrets-guard', key: 'missing' } as const, [])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'venv', '.venv', '__pycache__'])

// Reads the project's code (3 folders deep, 400 files at most) for the variable names it asks for.
async function codeReads($: any, root: string): Promise<string[]> {
  const names = new Set<string>()
  let seen = 0
  const walk = async (dir: string, depth: number) => {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const e of entries) {
      if (seen >= 400) return
      const path = `${dir}/${e.name}`
      if (e.kind === 'dir' && depth < 3 && !SKIP_DIRS.has(e.name)) await walk(path, depth + 1)
      else if (e.kind === 'file' && CODE_FILE.test(e.name)) {
        seen++
        for (const n of readsIn(await $.fs.read(path).catch(() => ''))) names.add(n)
      }
    }
  }
  await walk(root, 0)
  return [...names]
}

const TOOLS = [
  {
    name: 'env_list',
    description: 'List the key names in the project .env file, with each value masked (for example ●●●●492b). Never shows a value.',
    inputSchema: { type: 'object', properties: { file: { type: 'string', description: 'Defaults to .env in the working folder' } } },
  },
  {
    name: 'env_request',
    description:
      'Ask the user for one secret value, such as an API key. A pane opens with a card that says what the key is for and where to find it. The user pastes it there and it is written to .env. You never see the value: you get "[env] KEY is now set in .env" as the next message. Never ask for a key in the chat.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The variable name, for example MUX_TOKEN_ID' },
        why: { type: 'string', description: 'One line: what the key is for' },
        where: { type: 'array', items: { type: 'string' }, description: 'Short numbered steps to find the key' },
        link: { type: 'string', description: 'The dashboard page where the key lives' },
        format: { type: 'string', description: 'What the value looks like, for example "UUID, 36 characters"' },
        minLength: { type: 'number', description: 'Shortest valid length. Defaults to 8' },
        file: { type: 'string', description: 'Defaults to .env in the working folder' },
      },
      required: ['key', 'why'],
    },
  },
]

let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= doSetup($).catch(() => undefined) // a missing engine call must not stop the hooks
  return ready
}
async function doSetup($: any) {
  for (const t of TOOLS) await $.tool.register(t)
  await $.command.register({ name: 'env', description: 'Open the .env pane: key names with masked values' })
}

async function loadKeys($: any, file: string) {
  const text = await $.fs.read(file).catch(() => '')
  const list = listKeys(text)
  await update($, keys, () => list)
  await update($, fileAtom, () => file)
  const root = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) || '/' : await $.session.cwd().catch(() => '.')
  const reads = await codeReads($, root).catch(() => [] as string[])
  await update($, missing, () => missingKeys(reads, list.map(k => k.name)))
  return text as string
}

async function save($: any, req: EnvRequest, value: string) {
  const bad = checkValue(value, req.minLength)
  if (bad) {
    await update($, error, () => bad)
    return
  }
  const text = await $.fs.read(req.file).catch(() => '')
  await $.fs.write(req.file, setKey(text, req.key, value.trim()))
  await update($, error, () => '')
  await update($, requests, list => list.filter(r => r.key !== req.key))
  await loadKeys($, req.file)
  $.ui.toast(`${req.key} saved to ${req.file.split('/').pop()}`)
  void $.prompt.submit({ text: `[env] ${req.key} is now set in ${req.file.split('/').pop()}. Continue.` })
}

async function skip($: any, req: EnvRequest) {
  await update($, requests, list => list.filter(r => r.key !== req.key))
  await update($, error, () => '')
  void $.prompt.submit({ text: `[env] The user skipped ${req.key} for now. Carry on without it.` })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('command.run', { command: 'env' }, async $ => {
    await setup($)
    await loadKeys($, await read($, fileAtom))
    const list = await read($, keys)
    await $.ui.open({ id: PANE, title: '.env' })
    return { text: `${list.length} key(s) in .env. Values stay masked.` }
  })

  on('tool.call', { tool: 'mcp__secrets-guard__env_list' }, async ($, e: any) => {
    await setup($)
    const file = String(e.file || '.env')
    await loadKeys($, file)
    const list = await read($, keys)
    const gone = await read($, missing)
    const lines = [list.length ? `${list.length} key(s) in ${file} (values hidden):\n${list.map(k => `${k.name}  ${k.masked}`).join('\n')}` : `${file} has no keys yet.`]
    if (gone.length) lines.push(`The code reads ${gone.length} key(s) that ${file} does not set: ${gone.join(', ')}. Call env_request for each.`)
    else if (!list.length) lines.push('Call env_request to ask the user for one.')
    return { result: lines.join('\n') }
  })

  on('tool.call', { tool: 'mcp__secrets-guard__env_request' }, async ($, e: any) => {
    await setup($)
    const key = String(e.key ?? '').trim()
    if (!KEY_NAME.test(key)) return { result: `"${key}" is not a valid variable name. Use letters, digits and _ only.` }
    const file = String(e.file || '.env')
    const req: EnvRequest = {
      key,
      why: String(e.why ?? ''),
      where: Array.isArray(e.where) ? e.where.map(String).slice(0, 6) : [],
      link: e.link ? String(e.link) : undefined,
      format: e.format ? String(e.format) : undefined,
      minLength: Number(e.minLength) > 0 ? Number(e.minLength) : 8,
      file,
    }
    await loadKeys($, file)
    await update($, error, () => '')
    await update($, requests, list => [...list.filter(r => r.key !== key), req])
    await $.ui.open({ id: PANE, title: '.env', focus: true } as any)
    return { result: `Asked the user to paste ${key} into the .env pane. Stop here and wait: the next message will say "[env] ${key} is now set". Do not ask for the value in the chat.` }
  })

  on('tool.call', async ($, e: any, next) => {
    if (FILE_TOOLS.has(e.tool)) {
      const p = String(e.file_path ?? e.notebook_path ?? '')
      if (isSecretFile(p)) {
        $.ui.toast(`Stopped Claude opening ${p.split('/').pop()}`)
        return { deny: `secrets-guard: ${p} holds secrets, so Claude may not open it. ${ENV_HINT}` }
      }
      return next(e)
    }
    if (e.tool === 'Grep' && isSecretFile(String(e.path ?? ''))) {
      return { deny: `secrets-guard: ${e.path} holds secrets, so Claude may not search inside it. ${ENV_HINT}` }
    }
    if (e.tool !== 'Bash') return next(e)

    const why = secretCommand(String(e.command ?? ''))
    if (why) {
      $.ui.toast('Stopped a command that would print a secret')
      return { deny: `secrets-guard: ${why}. Use the variable by name instead (for example "$API_KEY" inside the command) so its value never reaches the chat. ${ENV_HINT}` }
    }
    const ran: any = await next(e)
    if (!ran?.result || typeof ran.result !== 'object') return ran
    const out = maskKeys(String(ran.result.stdout ?? ''))
    const err = maskKeys(String(ran.result.stderr ?? ''))
    if (out.count + err.count === 0) return ran
    $.ui.toast(`Masked ${out.count + err.count} key(s) in command output`)
    return { result: { ...ran.result, stdout: out.text, stderr: err.text } }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e) as any
    const queue = await read($, requests)
    const req = queue[0]
    const list = await read($, keys)
    const gone = await read($, missing)
    const file = (await read($, fileAtom)).split('/').pop()
    const bad = await read($, error)
    const accent = '#D97557'
    return (
      <Box flexDirection="column">
        {req && (
          <Box flexDirection="column" borderStyle="single" borderColor={accent} paddingX={1}>
            <Text>
              <Text bold color="black" backgroundColor={accent}>{' KEY REQUEST '}</Text>
              <Text bold>{`  ${req.key}`}</Text>
              {queue.length > 1 && <Text dimColor>{`  1 of ${queue.length}, then ${queue.slice(1).map(r => r.key).join(', ')}`}</Text>}
            </Text>
            {req.why && <Text>{`For    ${req.why}`}</Text>}
            {req.where.map((s, i) => (
              <Text key={`w${i}`}>{`${i === 0 ? 'Find   ' : '       '}${s}`}</Text>
            ))}
            {req.link && <Text color={accent}>{`Open   ${req.link}`}</Text>}
            {req.format && <Text dimColor>{`Shape  ${req.format}`}</Text>}
            <Input
              key="paste"
              label="Value  "
              placeholder={`goes into ${file} only. Claude never reads it`}
              value=""
              submitLabel="store it"
              autoFocus
              onSubmit={(v: string) => void save($, req, v)}
            />
            {bad && <Text color="red">{`Not stored: ${bad}`}</Text>}
            <Box flexDirection="row">
              <Button key="skip" label="Not now" onPress={() => void skip($, req)} />
            </Box>
          </Box>
        )}
        <Box flexDirection="column" marginTop={req ? 1 : 0}>
          <Text bold color={accent}>{`${file} · ${list.length} set${gone.length ? ` · ${gone.length} missing` : ''}`}</Text>
          {list.length === 0 && gone.length === 0 && <Text dimColor>Nothing set yet.</Text>}
          {list.map(k => (
            <Text key={`k-${k.name}`}>
              <Text color="green">{'✓ '}</Text>
              <Text>{k.name.padEnd(22)}</Text>
              <Text dimColor>{k.masked}</Text>
            </Text>
          ))}
          {gone.map(n => (
            <Text key={`m-${n}`}>
              <Text color="red">{'✕ '}</Text>
              <Text>{n.padEnd(22)}</Text>
              <Text color="red">your code reads it, not set</Text>
            </Text>
          ))}
          <Text dimColor>Claude sees key names and lengths. Never a character of a value.</Text>
        </Box>
      </Box>
    )
  })
}
