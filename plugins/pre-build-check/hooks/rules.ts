// Pure helpers: decide when a prompt is a build, and what to remind the model of.

const BUILD = /\b(page|site|website|landing page|app|component|feature|screen|form|dashboard|report|deck|slides?|email|post|caption|script|newsletter|graphic|infographic|design|template|doc|document)\b/i
const MAKE = /\b(make|build|create|write|draft|design|redo|redesign|generate|rework|clone|copy|recreate|match)\b/i

export function isBuildPrompt(text: string): boolean {
  if (text.length > 6000) return false // pasted transcripts and long jobs
  return BUILD.test(text) && MAKE.test(text)
}

export function hasReference(text: string): boolean {
  return /\b(reference|inspiration|like this|this style|clone|copy)\b|https?:\/\/|\[Image/i.test(text)
}

export const REFERENCE_RULE =
  'REFERENCE RULE: a reference gives the STRUCTURE (section order, layout, pacing). ' +
  "It never gives the styling: colours, fonts, boxes and logos stay the user's own. " +
  'Only copy the look itself when the user says "clone this" or "in this exact style".'

export function reminder(text: string, ruleFiles: string[]): string {
  const lines = ['PRE-BUILD CHECK (pre-build-check mod). This prompt asks for a build.']
  if (ruleFiles.length) lines.push(`Re-read the user's rules before writing a line: ${ruleFiles.join(', ')}. Follow every rule that applies to this build.`)
  if (hasReference(text)) lines.push(REFERENCE_RULE)
  lines.push('Say in one line which rules you applied. If a fact is not in those files or the prompt, say "not verified" rather than guess.')
  return lines.join('\n')
}
