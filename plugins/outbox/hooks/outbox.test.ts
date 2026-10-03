import { expect, test } from 'claude-code/testing'

import { fromBash, fromMcp, outgoing, words } from './parse'

test('a wa-send command is read as a WhatsApp message with its recipient, text and attachment', () => {
  expect(words(`wa-send team "Hi all, the deck is ready"`)).toEqual(['wa-send', 'team', 'Hi all, the deck is ready'])
  expect(fromBash(`~/bin/wa-send --image /tmp/x.png team "Deck is ready"`)).toEqual({ channel: 'WhatsApp', to: ['team'], text: 'Deck is ready', files: ['/tmp/x.png'] })
  expect(fromBash('wa-send --list')).toBe(null)
  expect(fromBash('wa-send --dry-run team "x"')).toBe(null)
  expect(fromBash('grep wa-send notes.md')).toBe(null)
  expect(fromBash('ls -la')).toBe(null)
})

test('email and Slack tools are caught, drafts are not', () => {
  const mail = fromMcp('mcp__claude_ai_Gmail__send_message', { to: 'sam@example.com', cc: ['ops@example.com'], subject: 'Rates', body: 'Hi Sam,\nRates attached.' })
  expect(mail).toEqual({ channel: 'Email', to: ['sam@example.com', 'ops@example.com (cc)'], subject: 'Rates', text: 'Hi Sam,\nRates attached.', files: [] })
  expect(fromMcp('mcp__claude_ai_Gmail__create_draft', { to: 'sam@example.com', body: 'x' })).toBe(null)
  expect(fromMcp('mcp__claude_ai_Slack__slack_send_message_draft', { channel_id: 'C1', message: 'x' })).toBe(null)
  expect(fromMcp('mcp__claude_ai_Slack__slack_send_message', { channel_id: 'C123', message: 'Shipped' })?.channel).toBe('Slack')
  expect(fromMcp('mcp__claude_ai_Gmail__search_threads', { query: 'x' })).toBe(null)
  expect(outgoing('Read', { file_path: 'a.md' })).toBe(null)
})

const PANE = { surface: 'terminal', component: 'Pane', props: {}, requestId: 'outbox', viewport: { rows: 30, columns: 90 } } as const

test('a send is held, shown in full, and goes out only when Send is pressed', async ($, on) => {
  const reached: any[] = []
  on('tool.call', async (_$: any, e: any) => (reached.push(e), { result: 'sent' }) as any)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('ui.open', async () => ({ value: undefined }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)

  const text = 'Hi team,\nThe mods board is live.\nComments by 5pm please.'
  const r: any = await $.tool.call({ tool: 'Bash', command: `wa-send team "${text}"` } as any)
  expect(reached.length).toBe(0) // nothing reached the tool
  expect(String(r.text ?? r.deny)).toContain('held for the user')

  await $.tool.call({ tool: 'Read', file_path: 'notes.md' } as any)
  expect(reached.map(x => x.tool)).toEqual(['Read']) // ordinary tools pass

  const ui = await $.ui.mount({ plugin: 'outbox', ...PANE } as any)
  const drawn = JSON.stringify(await ui.drawn())
  for (const line of ['WhatsApp', 'team', 'Hi team,', 'The mods board is live.', 'Comments by 5pm please.', 'Send', 'Edit', 'Hold']) expect(drawn).toContain(line)

  const sendKey = (JSON.stringify(await ui.drawn()).match(/"send-[^"]+"/) ?? [''])[0].replace(/"/g, '')
  await ui.press({ key: sendKey })
  expect(reached.length).toBe(2)
  expect(reached[1].command).toBe(`wa-send team "${text}"`) // exactly the held call
  expect(JSON.stringify(await ui.drawn())).toContain('✓ Sent: WhatsApp to team')
  await ui.unmount()
})

test('Hold keeps it listed, /outbox lists it, and Edit puts the text in the prompt box', async ($, on) => {
  const reached: any[] = []
  const fills: string[] = []
  on('tool.call', async (_$: any, e: any) => (reached.push(e), { result: 'sent' }) as any)
  on('ui.render', async () => ({ type: 'Box', props: {}, children: [] }) as any)
  on('ui.open', async () => ({ value: undefined }) as any)
  on('ui.toast', async () => ({ value: undefined }) as any)
  on('ui.status', async () => ({ value: undefined }) as any)
  on('prompt.fill', async (_$: any, e: any) => (fills.push(String(e.text)), { value: undefined }) as any)
  on('command.register', async () => ({ value: undefined }) as any)

  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__send_message', to: 'sam@example.com', subject: 'Rates', body: 'Hi Sam, rates attached.' } as any)
  const ui = await $.ui.mount({ plugin: 'outbox', ...PANE } as any)
  const k = async (p: string) => (JSON.stringify(await ui.drawn()).match(new RegExp(`"${p}-[^"]+"`)) ?? [''])[0].replace(/"/g, '')

  await ui.press({ key: await k('hold') })
  expect(JSON.stringify(await ui.drawn())).toContain('on hold')
  const listed: any = await ($.command as any).run({ command: 'outbox', args: '' })
  expect(listed.text).toContain('Email to sam@example.com')
  expect(listed.text).toContain('Subject: Rates')

  await ui.press({ key: await k('edit') })
  expect(fills[0]).toContain('Hi Sam, rates attached.')
  expect(reached.length).toBe(0) // Edit and Hold never send
  await ui.unmount()
})
