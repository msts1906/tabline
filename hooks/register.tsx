import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Tab } from '../types'

const PANE = 'tabline'
const POLL_MS = 3000
const TARGET = /^[^\s:.]+:\d+\.\d+$/ // tmux session:window.pane

const tabs = atom({ plugin: 'tabline', key: 'tabs' } as const, [] as Tab[], {
  shape: 'tabs-2',
})

// Claude Code's session registry is internal and may change: a file that
// doesn't parse into these fields is skipped, so a format change shows no tabs.
export function parse(text: string): Omit<Tab, 'tty' | 'pane'> | undefined {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text)
  } catch (err) {
    if (err instanceof SyntaxError) return undefined
    throw err
  }
  if (typeof j.pid !== 'number' || typeof j.sessionId !== 'string') return undefined
  const cwd = typeof j.cwd === 'string' ? j.cwd : ''
  return {
    pid: j.pid,
    id: j.sessionId,
    name: typeof j.name === 'string' ? j.name : cwd.split('/').pop() || String(j.pid),
    cwd,
    status: typeof j.status === 'string' ? j.status : '',
  }
}

// Input: `tmux list-panes -a -F '#{pane_tty} #{session_name}:#{window_index}.#{pane_index}'`.
// Keyed by bare tty ("ttys003"), the form `ps` prints.
export function parsePanes(text: string): Map<string, string> {
  const panes = new Map<string, string>()
  for (const line of text.split('\n')) {
    const [path, target] = line.trim().split(' ')
    if (path && target && TARGET.test(target)) panes.set(path.replace(/^\/dev\//, ''), target)
  }
  return panes
}

// Commands that bring a tmux pane forward. Window first, then pane inside it.
export function selectArgs(target: string): string[][] | undefined {
  if (!TARGET.test(target)) return undefined
  const win = target.slice(0, target.lastIndexOf('.'))
  return [
    ['tmux', 'select-window', '-t', win],
    ['tmux', 'select-pane', '-t', target],
  ]
}

// A new window in `session`, running claude in `cwd`. Argv only, no shell.
// The mod's own folder is passed with --plugin-dir, so the new session has the panel too.
export function newWindowArgs(session: string, cwd: string, pluginRoot: string): string[] | undefined {
  if (!/^[^\s:.]+$/.test(session) || !cwd.startsWith('/')) return undefined
  if (!/^[\w/.-]+$/.test(pluginRoot)) return undefined
  return ['tmux', 'new-window', '-t', `${session}:`, '-c', cwd, `claude --plugin-dir ${pluginRoot}`]
}

// A window's tab name: the first prompt, one line, cut short.
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 28 ? `${line.slice(0, 27)}…` : line
}

let isOpen = false
let stop: (() => void) | undefined
let isNamed = false // resets when the mod reloads; a reload may rename once more

async function refresh($: EngineInterface) {
  const home =
    (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  const dir = `${home}/sessions`
  const names = (await $.fs.list(dir)).map(f => f.name).filter(n => n.endsWith('.json'))
  // allSettled: a session may delete its file between list and read.
  const files = await Promise.allSettled(names.map(n => $.fs.read(`${dir}/${n}`)))
  const found = files.flatMap(f =>
    f.status === 'fulfilled' ? (parse(String(f.value)) ?? []) : [],
  )
  let next: Tab[] = []
  if (found.length) {
    // One ps call gives liveness (stale registry files) and each tty.
    const ps = await $.process.run(['ps', '-o', 'pid=,tty=', '-p', found.map(s => s.pid).join(',')])
    const ttys = new Map(
      ps.stdout.split('\n').flatMap(l => {
        const m = l.trim().match(/^(\d+)\s+(\S+)$/)
        return m ? [[Number(m[1]), m[2]] as const] : []
      }),
    )
    // No tmux server running makes list-panes exit non-zero: then no pane matches.
    const panes = parsePanes((await $.process.run(['tmux', 'list-panes', '-a', '-F', '#{pane_tty} #{session_name}:#{window_index}.#{pane_index}'])).stdout)
    next = found.flatMap(s => {
      const tty = ttys.get(s.pid)
      return tty ? [{ ...s, tty, pane: panes.get(tty) }] : []
    })
    next.sort((a, b) => a.pid - b.pid)
  }
  await update($, tabs, () => next)
}

async function open($: EngineInterface) {
  isOpen = true
  await refresh($)
  await $.ui.open({ id: PANE, title: 'Sessions' })
  stop ??= $.clock.every(POLL_MS, () => {
    if (isOpen) void refresh($)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tabs', description: 'Show a tab per live Claude Code session' })
    void open($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const pane = await $.env.get('TMUX_PANE')
    const title = titleFrom(String(e.text ?? ''))
    if (!isNamed && pane && title) {
      isNamed = true
      // Argv only; the title never reaches a shell.
      await $.process.run(['tmux', 'rename-window', '-t', pane, title])
    }
    return next(e)
  })

  on('command.run', { command: 'tabs' }, async $ => {
    await open($)
    return { text: 'Session tabs opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tabs)
    const me = await $.session.id()

    async function run(argvs: string[][] | undefined, failure: string) {
      if (!argvs) return $.ui.toast(failure)
      for (const argv of argvs) {
        const r = await $.process.run(argv)
        if (r.exitCode !== 0) return $.ui.toast(`${argv[1]} failed: ${r.stderr.trim().slice(0, 160)}`)
      }
    }

    function jump(tab: Tab) {
      if (tab.id === me) return
      if (!tab.pane) return $.ui.toast('Not in tmux: start that session inside tmux to switch to it')
      void run(selectArgs(tab.pane), 'cannot switch to that pane')
    }

    function create() {
      const mine = list.find(t => t.id === me)
      if (!mine?.pane) return $.ui.toast('Start this session inside tmux to add sessions here')
      const session = mine.pane.split(':')[0]
      const argv = newWindowArgs(session, mine.cwd, $.plugin.root)
      void run(argv && [argv], 'cannot start a session here').then(() => refresh($))
    }

    return (
      <Box flexDirection="column">
        <Button key="new" onPress={create}>
          <Text bold>+ New session</Text>
        </Button>
        {list.length === 0 && <Text dimColor>No live sessions found.</Text>}
        {list.map(tab => (
          <Button key={tab.id} onPress={() => jump(tab)}>
            <Text bold={tab.id === me} color={tab.status === 'busy' ? 'yellow' : undefined}>
              {tab.id === me ? '▸' : tab.status === 'busy' ? '●' : '○'} {tab.name}
            </Text>
            <Text dimColor> {tab.cwd.split('/').pop()}{tab.pane ? '' : ' (not in tmux)'}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
