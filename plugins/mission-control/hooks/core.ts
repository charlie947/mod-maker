// The pure half of mission-control: plain-English activity lines, the plan, the stage bar.
// Nothing here touches the engine, so every line the panel shows is tested.

import type { Ask, Step } from '../types'

const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Server names people recognise. Anything else is shown as "a connected app".
const APPS: Record<string, string> = {
  notion: 'Notion', claude_ai_Gmail: 'Gmail', claude_ai_Google_Drive: 'Google Drive',
  claude_ai_Google_Calendar: 'Google Calendar', figma: 'Figma', 'claude-in-chrome': 'Chrome',
}

// One tool call in, one line a marketer can read out. null = not worth showing.
export function describe(tool: string, input: any = {}): string | null {
  const file = base(input.file_path ?? input.notebook_path ?? input.path)
  switch (tool) {
    case 'Read': return file ? `Reading ${file}` : 'Reading a file'
    case 'Edit': case 'MultiEdit': return file ? `Editing ${file}` : 'Editing a file'
    case 'Write': return file ? `Writing ${file}` : 'Writing a file'
    case 'NotebookEdit': return `Editing ${file || 'a notebook'}`
    case 'Grep': return input.pattern ? `Searching files for "${cut(String(input.pattern), 30)}"` : 'Searching files'
    case 'Glob': return 'Looking for files'
    case 'Bash': return input.description ? cap(cut(String(input.description), 60)) : 'Running a command'
    case 'WebSearch': return input.query ? `Searching the web for "${cut(String(input.query), 30)}"` : 'Searching the web'
    case 'WebFetch': {
      const host = String(input.url ?? '').match(/^https?:\/\/([^/]+)/)?.[1]
      return host ? `Reading a web page on ${host.replace(/^www\./, '')}` : 'Reading a web page'
    }
    case 'Agent': case 'Task': return input.description ? `Asking a helper: ${cut(String(input.description), 40)}` : 'Asking a helper'
    case 'Skill': return input.skill ? `Opening the ${String(input.skill).split(':').pop()} skill` : 'Opening a skill'
    case 'SendMessage': return 'Messaging another session'
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Updating the plan'
    case 'AskUserQuestion': return 'Asking you a question'
    case 'ToolSearch': case 'TaskList': case 'TaskGet': return null
  }
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (mcp) {
    if (mcp[1] === 'mission-control') return null
    const app = APPS[mcp[1]] ?? 'a connected app'
    const verb = mcp[2].replace(/^(notion|mcp)-/, '').replace(/[_-]+/g, ' ')
    return `Using ${app}: ${verb}`
  }
  return 'Working'
}

// ---- the plan ----

export function fromTodos(todos: any[]): Step[] {
  return (todos ?? []).map(t => ({
    label: String(t.content ?? t.subject ?? ''),
    status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'now' : 'todo',
  }))
}

export function setPlan(labels: string[]): Step[] {
  const steps: Step[] = labels.map(l => ({ label: String(l).trim(), status: 'todo' as const })).filter(s => s.label)
  if (steps[0]) steps[0].status = 'now'
  return steps
}

// Marks step n (1-based) done and moves "now" to the first step still to do.
export function finishStep(steps: readonly Step[], n: number): Step[] {
  const next = steps.map((s, i) => (i === n - 1 ? { ...s, status: 'done' as const } : s))
  if (!next.some(s => s.status === 'now')) {
    const i = next.findIndex(s => s.status === 'todo')
    if (i >= 0) next[i] = { ...next[i], status: 'now' }
  }
  return next
}

export function applyTask(steps: readonly Step[], tool: string, input: any): Step[] {
  if (tool === 'TaskCreate') return [...steps, { label: String(input.subject ?? ''), status: 'todo' }]
  if (tool === 'TaskUpdate' && input.status) {
    const i = Number(input.taskId) - 1
    if (!steps[i]) return [...steps]
    if (input.status === 'deleted') return steps.filter((_, j) => j !== i)
    const status = input.status === 'completed' ? 'done' : input.status === 'in_progress' ? 'now' : 'todo'
    return steps.map((s, j) => (j === i ? { ...s, status } : s))
  }
  return [...steps]
}

// "████████░░░░  2 of 4" in a fixed number of cells, so it reads the same at any width.
export function bar(steps: readonly Step[], cells = 24): { fill: string; empty: string; label: string } {
  const total = steps.length
  const done = steps.filter(s => s.status === 'done').length
  const n = total ? Math.round((done / total) * cells) : 0
  return { fill: '█'.repeat(n), empty: '░'.repeat(cells - n), label: total ? `${done} of ${total}` : 'no plan yet' }
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export function tick(asks: readonly Ask[], id: number, proof: string): { asks: Ask[]; found: boolean } {
  let found = false
  const next = asks.map(a => (a.id === id ? ((found = true), { ...a, done: true, proof }) : a))
  return { asks: next, found }
}
