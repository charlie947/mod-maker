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
