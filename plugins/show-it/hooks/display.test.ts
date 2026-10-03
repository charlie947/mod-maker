import { expect, test } from 'claude-code/testing'

import { displayPath, showReply } from './paths'

test('a path on screen is relative in the project, ~ in home, and a file name elsewhere', () => {
  expect(displayPath('/Users/sam/mods-demo/chart-two.png', '/Users/sam', '/Users/sam/mods-demo')).toBe('chart-two.png')
  expect(displayPath('/Users/sam/mods-demo/out/q3.html', '/Users/sam', '/Users/sam/mods-demo/')).toBe('out/q3.html')
  expect(displayPath('/Users/sam/Desktop/a.png', '/Users/sam', '/Users/sam/mods-demo')).toBe('~/Desktop/a.png')
  expect(displayPath('/private/tmp/x/render.mp4', '/Users/sam', '/Users/sam/mods-demo')).toBe('render.mp4')
  expect(displayPath('/Users/samuel/b.png', '/Users/sam')).toBe('b.png')
})

test('/show names the file without the full path, when it opens and when it fails', () => {
  const home = '/Users/sam'
  const cwd = '/Users/sam/mods-demo'
  expect(showReply(true, '/Users/sam/mods-demo/chart-two.png', home, cwd)).toBe('Brought to the front: chart-two.png')
  expect(showReply(false, '/Users/sam/Desktop/b.png', home, cwd)).toBe('Could not open ~/Desktop/b.png')
  expect(showReply(true, '/private/tmp/x/render.mp4', home, cwd)).not.toContain('/private/tmp')
})
