import { expect, mock, test } from 'claude-code/testing'

// A whole turn through the engine kit: plan, steps, sounds and the wait for your OK.
// It also prints each drawn panel after FRAMESJSON, which is how the demo clip is made.
const txt = (n: any): string => (typeof n === 'string' ? n : (n?.children ?? []).map(txt).join(' '))
test('a full turn fills the bar, plays a sound per step and waits for your OK', async ($, on) => {
  const clk = mock.clock(on, { now: 1_000_000 })
  const plays: string[] = []
  on('audio.play', async (_$: any, e: any) => { plays.push(String(e.clip?.asset ?? JSON.stringify(e.clip))); return {} as any })
  on('ui.render', async () => null as any)
  on('tool.check', async (_$: any, e: any) => (e.tool === 'Bash' && /publish/.test(String(e.input?.command)) ? { decision: 'ask' } : { decision: 'allow' }) as any)
  on('tool.call', async () => ({ result: 'ok' }) as any)
  const frames: any[] = []
  let t = 0
  const snap = async (label: string, dt: number) => {
    t += dt
    await clk.advance(dt * 1000)
    const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 14, bodyColumns: 80 } } as any)
    frames.push({ t, label, tree: await ui.drawn(), plays: [...plays] })
    await ui.unmount()
  }
  await $.tool.call({ tool: 'mcp__mission-control__set_plan', steps: ['Read the brief', 'Draft the post', 'Make the graphic', 'Publish it'] } as any)
  await snap('plan', 0)
  await $.tool.call({ tool: 'Read', file_path: 'brief.md' } as any)
  await snap('reading', 1.2)
  await $.tool.call({ tool: 'mcp__mission-control__step_done', step: 1 } as any)
  await snap('step1', 1.0)
  await $.tool.call({ tool: 'Write', file_path: 'post.md', content: 'x' } as any)
  await snap('writing', 1.4)
  await $.tool.call({ tool: 'mcp__mission-control__step_done', step: 2 } as any)
  await snap('step2', 1.0)
  await $.tool.call({ tool: 'Bash', command: 'node render.js', description: 'render the graphic' } as any)
  await $.tool.call({ tool: 'mcp__mission-control__step_done', step: 3 } as any)
  await snap('step3', 1.6)
  const chk: any = await $.tool.check({ tool: 'Bash', tool_use_id: 'toolu_demo1', input: { command: 'npm publish', description: 'publish the post' } } as any)
  await snap('ask', 1.0)
  await snap('ask2', 2.0)
  console.log('FRAMESJSON' + JSON.stringify({ frames, chk, plays }))
  const at = (label: string) => txt(frames.find(f => f.label === label).tree)
  expect(at('plan')).toContain('Step 1/4')
  expect(at('step1')).toContain('1 of 4 steps · 25%')
  expect(at('step1')).toContain('Step 2/4')
  expect(at('step3')).toContain('3 of 4 steps · 75%')
  expect(chk.decision).toBe('ask')
  expect(at('ask')).toContain('YOUR OK')
  expect(at('ask')).toContain('Claude is waiting for your OK to publish the post')
  expect(plays).toEqual(['sounds/step.wav', 'sounds/step.wav', 'sounds/step.wav', 'sounds/ask.wav'])
})
