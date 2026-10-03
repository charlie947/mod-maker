import { expect, test } from 'claude-code/testing'

import { isVisual, visualPathsIn } from './paths'

const HOME = '/Users/sam'

test('finds render paths in a command and its output', () => {
  const text = 'node scripts/render.js x.html --name a\nSaved /Users/sam/Desktop/renders/a.png\n'
  expect(visualPathsIn(text, HOME)).toEqual(['/Users/sam/Desktop/renders/a.png'])
})

test('expands ~ and file:// paths', () => {
  expect(visualPathsIn('open file:///Users/sam/Desktop/q3.html and ~/Desktop/b.mp4', HOME)).toEqual([
    '/Users/sam/Desktop/q3.html',
    '/Users/sam/Desktop/b.mp4',
  ])
})

test('skips temp, scratchpad, node_modules and non-visual files', () => {
  expect(isVisual('/private/tmp/x/scratchpad/a.png')).toBe(false)
  expect(isVisual('/Users/sam/proj/node_modules/x/a.html')).toBe(false)
  expect(isVisual('/Users/sam/Desktop/notes.md')).toBe(false)
  expect(isVisual('/Users/sam/Desktop/board.html')).toBe(true)
})

test('finds a file a command wrote by a bare name, read against its folder', () => {
  const text = 'python3 plot.py > /dev/null && ls\nSaved chart.png and out/q3.html'
  expect(visualPathsIn(text, HOME, '/Users/sam/proj')).toEqual(['/Users/sam/proj/chart.png', '/Users/sam/proj/out/q3.html'])
})

test('without a folder, bare names are left alone', () => {
  expect(visualPathsIn('Saved chart.png', HOME)).toEqual([])
})
