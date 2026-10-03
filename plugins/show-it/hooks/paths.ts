// Finds visual files a tool call made or named. Pure, so it is easy to test.

const VISUAL = /\.(html?|png|jpe?g|gif|webp|mp4|mov|pdf|svg)$/i
const SKIP = /\/(node_modules|\.git|\.claude|scratchpad|\.cache)\/|^\/(private\/)?tmp\/|\/private\/var\//
const ABS_PATH = /(?<![\w.~-])(?:file:\/\/)?((?:\/|~\/)[^\s'"`<>|;,()]+?\.(?:html?|png|jpe?g|gif|webp|mp4|mov|pdf|svg))(?=[\s'"`<>|;,()]|$)/gi

export function isVisual(path: string): boolean {
  return VISUAL.test(path) && !SKIP.test(path)
}

// A bare name like chart.png or out/chart.png, read against the folder the command ran in.
const REL_PATH = /(?:^|[\s'"`=>(])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:html?|png|jpe?g|gif|webp|mp4|mov|pdf|svg))(?=[\s'"`<>|;,()]|$)/gi

export function visualPathsIn(text: string, home: string, cwd?: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(ABS_PATH)) {
    const p = m[1].startsWith('~/') ? home + m[1].slice(1) : m[1]
    if (isVisual(p) && !out.includes(p)) out.push(p)
  }
  if (cwd) {
    for (const m of text.matchAll(REL_PATH)) {
      const p = `${cwd.replace(/\/$/, '')}/${m[1].replace(/^\.\//, '')}`
      if (isVisual(p) && !out.includes(p)) out.push(p)
    }
  }
  return out
}

// The path as the user should see it on screen: relative inside the project, ~ inside home,
// and only the file name anywhere else. The full path never reaches the chat.
export function displayPath(p: string, home: string, cwd?: string): string {
  const dir = (d?: string) => (d ? d.replace(/\/$/, '') + '/' : '')
  if (cwd && p.startsWith(dir(cwd))) return p.slice(dir(cwd).length)
  if (home && p.startsWith(dir(home))) return `~/${p.slice(dir(home).length)}`
  return p.split('/').pop() ?? p
}

// What /show says in the chat.
export function showReply(ok: boolean, path: string, home: string, cwd?: string): string {
  const p = displayPath(path, home, cwd)
  return ok ? `Brought to the front: ${p}` : `Could not open ${p}`
}
