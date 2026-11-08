export type Tab = {
  pid: number
  id: string
  name: string
  cwd: string
  status: string
  tty: string
  // tmux target `session:window.pane`, absent when the session is not in tmux
  pane?: string
}

declare module 'claude-code' {
  interface PluginState {
    tabline: { tabs: Shaped<Tab[]> }
  }
}
