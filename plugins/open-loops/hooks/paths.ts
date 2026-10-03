// Paths in an ask or its proof, as the user should see them on screen: relative inside the
// session folder, ~/ inside home. A full /Users/<name> path never reaches the pane.
export function shortPaths(text: string, home: string, cwd?: string): string {
  let out = text.replace(/file:\/\//g, '')
  const dir = (d: string) => d.replace(/\/+$/, '') + '/'
  if (cwd) out = out.split(dir(cwd)).join('').split(cwd.replace(/\/+$/, '')).join('.')
  if (home) out = out.split(dir(home)).join('~/')
  return out.replace(/\/(Users|home)\/[^/\s]+\//g, '~/')
}
