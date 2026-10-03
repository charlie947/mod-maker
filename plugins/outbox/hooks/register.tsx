import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Held } from '../types'
import { argsOf, attachLine, outgoing } from './parse'

// Nothing Claude writes to a person leaves without your OK. A send (wa-send, slack-send, an email or
// Slack tool) is held, shown in full with who it goes to, and goes out only when you press Send.

const PANE = 'outbox'
const held = atom({ plugin: 'outbox', key: 'held' } as const, [])
const accent = '#D97557'

let ready: Promise<void> | undefined
function setup($: any): Promise<void> {
  ready ??= $.command
    .register({ name: 'outbox', description: 'Show the messages waiting for your OK' })
    .catch(() => undefined)
  return ready
}

async function waiting($: any) {
  const n = (await read($, held)).filter((h: Held) => h.state === 'held').length
  $.ui.status(n ? `Outbox: ${n} waiting for your OK` : undefined)
}

async function setState($: any, id: string, state: Held['state'], note?: string) {
  await update($, held, list => list.map(h => (h.id === id ? { ...h, state, note } : h)))
  await waiting($)
}

// Runs the held call exactly as Claude wrote it. Only a press of Send reaches here.
async function send($: any, h: Held) {
  await setState($, h.id, 'sending')
  try {
    const r: any = await $.tool.call({ tool: h.tool, ...h.input })
    const failed = r?.deny !== undefined || r?.isError === true
    await setState($, h.id, failed ? 'failed' : 'sent', failed ? String(r?.deny ?? r?.text ?? 'the tool returned an error').slice(0, 200) : undefined)
    $.ui.toast(failed ? `Outbox: the ${h.channel} message did not send` : `Outbox: sent to ${h.to.join(', ')}`)
  } catch (err: any) {
    await setState($, h.id, 'failed', String(err?.message ?? err).slice(0, 200))
  }
}

async function edit($: any, h: Held) {
  await update($, held, list => list.filter(x => x.id !== h.id))
  await waiting($)
  await $.prompt.fill({ text: `Change this ${h.channel} message to ${h.to.join(', ')} and hold it for my OK again:\n\n${h.text}` })
}

const lines = (h: Held) => {
  const out = [`${h.channel} to ${h.to.join(', ')}`]
  if (h.subject) out.push(`Subject: ${h.subject}`)
  out.push(h.text || '(no text)')
  out.push(attachLine(h.files))
  return out.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await setup($)
    return next(e)
  })

  on('tool.call', async ($, e: any, next) => {
    // The call Send makes is ours: let it go to the tool.
    if ((next as any).origin?.plugin === $.plugin.name) return next(e)
    const args = argsOf(e)
    const out = outgoing(String(e.tool), args as any)
    if (!out) return next(e)
    const h: Held = { id: String(e.tool_use_id ?? `h${Math.random().toString(36).slice(2, 8)}`), tool: String(e.tool), input: args, ...out, heldMs: 0, state: 'held' }
    // A hook that throws is skipped and the send would go out, so nothing below may stop the hold.
    try {
      await setup($)
      h.heldMs = await $.clock.now().catch(() => 0)
      await update($, held, list => [h, ...list].slice(0, 30))
      await waiting($)
      void Promise.resolve($.ui.open({ id: PANE, title: 'Outbox' })).catch(() => undefined)
      $.ui.toast(`Outbox: a ${h.channel} message to ${h.to.join(', ')} is waiting for your OK`)
    } catch { /* the deny below still holds the message */ }
    return {
      deny: `outbox: held for the user's OK. The ${h.channel} message to ${h.to.join(', ')} is in the Outbox pane, in full. It sends only when the user presses Send there. Do not send it again and do not look for another way to send it. Tell the user it is waiting in the Outbox.`,
    }
  })

  on('command.run', { command: 'outbox' }, async $ => {
    await setup($)
    void $.ui.open({ id: PANE, title: 'Outbox' })
    const list = (await read($, held)).filter(h => h.state === 'held' || h.state === 'kept')
    if (list.length === 0) return { text: 'Nothing is waiting. Every message Claude tries to send stops here first.' }
    return { text: `${list.length} waiting for your OK:\n\n${list.map((h, i) => `${i + 1}. ${lines(h)}`).join('\n\n')}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, held)
    const open = list.filter(m => m.state === 'held' || m.state === 'kept' || m.state === 'sending')
    const done = list.filter(m => m.state === 'sent' || m.state === 'failed').slice(0, 4)
    return (
      <Box flexDirection="column">
        <Text bold color={accent}>
          {(() => {
            const w = open.filter(m => m.state !== 'kept').length
            const k = open.length - w
            return open.length ? `✉ ${[w ? `${w} waiting for your OK` : '', k ? `${k} on hold` : ''].filter(Boolean).join(' · ')}` : '✉ Nothing waiting'
          })()}
        </Text>
        <Text dimColor>Nothing Claude writes to a person leaves until you press Send.</Text>
        {open.map(m => (
          <Box key={m.id} flexDirection="column" borderStyle="round" borderColor={m.state === 'kept' ? 'gray' : accent} paddingX={1} marginTop={1}>
            <Text>
              <Text bold>{m.channel}</Text>
              <Text dimColor>{'  to  '}</Text>
              <Text bold color={accent}>{m.to.join(', ')}</Text>
              {m.state === 'kept' && <Text dimColor>{'   · on hold'}</Text>}
              {m.state === 'sending' && <Text dimColor>{'   · sending…'}</Text>}
            </Text>
            {m.subject && <Text>{`Subject: ${m.subject}`}</Text>}
            <Box flexDirection="column" marginTop={1}>
              {(m.text || '(no text)').split('\n').map((l, i) => (
                <Text key={`${m.id}-l${i}`}>{l || ' '}</Text>
              ))}
            </Box>
            <Text bold={m.files.length > 0}>{attachLine(m.files)}</Text>
            {m.state !== 'sending' && (
              <Box flexDirection="row" marginTop={1}>
                <Button key={`send-${m.id}`} label="Send" onPress={() => void send($, m).catch(() => undefined)} />
                <Text>{'  '}</Text>
                <Button key={`edit-${m.id}`} label="Edit" onPress={() => void edit($, m).catch(() => undefined)} />
                {m.state !== 'kept' && <Text>{'  '}</Text>}
                {m.state !== 'kept' && <Button key={`hold-${m.id}`} label="Hold" onPress={() => void setState($, m.id, 'kept').catch(() => undefined)} />}
              </Box>
            )}
          </Box>
        ))}
        {done.map(m => (
          <Text key={`d-${m.id}`} color={m.state === 'sent' ? 'green' : 'red'}>
            {m.state === 'sent' ? `✓ Sent: ${m.channel} to ${m.to.join(', ')}` : `✕ Not sent: ${m.channel} to ${m.to.join(', ')}${m.note ? ` (${m.note})` : ''}`}
          </Text>
        ))}
      </Box>
    )
  })
}
