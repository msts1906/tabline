import { expect, test } from 'claude-code/testing'
import { newWindowArgs, parse, parsePanes, selectArgs, titleFrom } from './register'

test('titleFrom makes one short line from the first prompt', async () => {
  expect(titleFrom('  fix the\n  login   bug ')).toBe('fix the login bug')
  expect(titleFrom('x'.repeat(40))).toBe(`${'x'.repeat(27)}…`)
})

test('parse keeps only well-formed registry files', async () => {
  const ok = parse('{"pid":7,"sessionId":"s","cwd":"/a/b","name":"n","status":"busy"}')
  expect(ok?.name).toBe('n')
  expect(parse('{"pid":"7"}')).toBe(undefined)
  expect(parse('not json')).toBe(undefined)
})

test('parsePanes maps bare ttys to tmux targets', async () => {
  const panes = parsePanes('/dev/ttys003 work:1.0\n/dev/ttys004 work:2.1\n')
  expect(panes.get('ttys003')).toBe('work:1.0')
  expect(panes.get('ttys004')).toBe('work:2.1')
  expect(panes.get('ttys009')).toBe(undefined)
})

test('selectArgs selects the window, then the pane', async () => {
  expect(selectArgs('work:2.1')).toEqual([
    ['tmux', 'select-window', '-t', 'work:2'],
    ['tmux', 'select-pane', '-t', 'work:2.1'],
  ])
  expect(selectArgs('work; rm -rf ~')).toBe(undefined)
})

test('newWindowArgs runs claude with the mod, in the session folder', async () => {
  expect(newWindowArgs('work', '/a/b', '/mods/tabline')).toEqual([
    'tmux', 'new-window', '-t', 'work:', '-c', '/a/b', 'claude --plugin-dir /mods/tabline',
  ])
  expect(newWindowArgs('work', 'relative', '/mods/tabline')).toBe(undefined)
  expect(newWindowArgs('a b', '/x', '/mods/tabline')).toBe(undefined)
  expect(newWindowArgs('work', '/a/b', '/x; rm -rf ~')).toBe(undefined)
})
