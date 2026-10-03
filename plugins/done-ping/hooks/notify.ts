// Builds the command that shows a desktop notification. Pure, so it is tested without a desktop.

const clean = (s: string, n: number) => s.replace(/\s+/g, ' ').replace(/["\\]/g, "'").trim().slice(0, n)

export function notifyArgv(os: string, title: string, message: string): string[] | null {
  const t = clean(title, 60), m = clean(message, 180)
  if (os === 'Darwin') return ['osascript', '-e', `display notification "${m}" with title "${t}" sound name "Glass"`]
  if (os === 'Linux') return ['notify-send', '--app-name=Claude Code', t, m]
  return null
}

// First line of the answer, so the notification says what finished.
export function summary(answer: string): string {
  const line = answer.split('\n').map(l => l.replace(/[#*`>_]/g, '').trim()).find(Boolean)
  return line ? line : 'Claude finished.'
}
