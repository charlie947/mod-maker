import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { DEFAULT_BAR, grade } from './grade'
import type { Bar } from './grade'

// After each answer, a small band says how long it was, its longest sentence and the jargon in it.
// Over your bar, a button drafts "say it simpler" into your prompt box. It never sends it.

const last = atom({ plugin: 'plain-reply', key: 'grade' } as const, null)
const ASK = 'Rewrite that in 5 short sentences, no jargon.'
let bar: Bar = DEFAULT_BAR

async function score($: any, text: string) {
  await update($, last, () => (text.trim() ? grade(text, bar) : null))
}

export const register: Register = (on, options) => {
  const o = (options ?? {}) as Partial<Bar>
  bar = {
    maxWords: Number(o.maxWords ?? DEFAULT_BAR.maxWords),
    maxSentence: Number(o.maxSentence ?? DEFAULT_BAR.maxSentence),
    maxJargon: Number(o.maxJargon ?? DEFAULT_BAR.maxJargon),
  }

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && !e.isAborted) await score($, e.answer)
    return next(e)
  })

  // The same grade from the classic Stop event, which carries the last answer too.
  on('classic.Stop', async ($, e: any, next) => {
    if (typeof e.last_assistant_message === 'string') await score($, e.last_assistant_message)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, last, () => null) // a new question clears the old grade
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, last)
    if (!g || (e.props as any).hasSurvey || (e.props as any).isWorking) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const accent = '#D97557'
    const stat = (label: string, value: string, bad: boolean) => (
      <Text>
        <Text dimColor>{label} </Text>
        <Text bold={bad} color={bad ? accent : undefined}>{value}</Text>
        <Text dimColor>{'   '}</Text>
      </Text>
    )
    const jargonText = g.jargon.length ? `${g.jargon.length} (${g.jargon.slice(0, 4).join(', ')}${g.jargon.length > 4 ? '…' : ''})` : 'none'
    if (!g.over) {
      return (
        <Text dimColor>{`✓ plain reply · ${g.words} words · longest sentence ${g.longest} · jargon ${g.jargon.length}`}</Text>
      )
    }
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
        <Text>
          <Text bold color={accent}>{'◐ HARD TO READ  '}</Text>
          <Text dimColor>{`over your bar: ${g.reasons.join(' · ')}`}</Text>
        </Text>
        <Box flexDirection="row">
          {stat('Words', `${g.words}/${bar.maxWords}`, g.words > bar.maxWords)}
          {stat('Longest sentence', `${g.longest}/${bar.maxSentence}`, g.longest > bar.maxSentence)}
          {stat('Jargon', jargonText, g.jargon.length >= bar.maxJargon)}
        </Box>
        <Box flexDirection="row">
          <Button key="simpler" label="Say it simpler" onPress={() => $.prompt.fill({ text: ASK })} />
          <Text dimColor>{'  puts a request in your prompt box. You press Enter.'}</Text>
        </Box>
      </Box>
    )
  })
}
