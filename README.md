# tabline

Session tabs for Claude Code. A sidebar lists your running sessions, one tab each. Click a tab to jump to that session. Click **+ New session** to start another one in the same tmux session.

Switching needs **tmux**: a session has to run inside tmux for its tab to switch to it. Sessions outside tmux are listed, marked `(not in tmux)`.

## Requirements

- macOS or Linux with `tmux` on your PATH (`brew install tmux`)
- Claude Code with mods enabled (the terminal UI, fullscreen rendering, 144 columns or wider so the sidebar opens)
- `claude` on the PATH used by tmux, since new sessions run `claude --plugin-dir …`

## Install

    git clone https://github.com/msts1906/tabline.git
    claude plugin marketplace add ./tabline
    claude plugin install tabline@tabline --scope user

Then start Claude inside tmux and run `/tabs`.

## Use

- `/tabs` opens the sidebar.
- A tab marked `▸` is the current session. `●` is busy, `○` is idle.
- Clicking a tab selects its tmux window and pane.
- `+ New session` opens a new tmux window in your current folder and runs `claude` there.

## How it works

- Reads Claude Code's session registry, `~/.claude/sessions/*.json` (or under `$CLAUDE_CONFIG_DIR`). Only the `.json` files are read.
- Runs `ps` for each session's tty and `tmux list-panes` to match ttys to panes. Refreshes every 3 seconds while the sidebar is open.
- Runs only `ps`, `tmux` and nothing over the network. Commands are passed as argument lists, never through a shell.

The registry format is internal to Claude Code. If it changes, the list shows no tabs rather than failing.

## Limits

- Only sessions started inside tmux can be switched to.
- Sessions started before tmux was running stay outside it.

## Develop

    claude plugin test .            # tests in hooks/*.test.ts
    claude plugin validate .        # the events and calls the mod uses

Types come from Claude Code and are generated into `.claude-plugin/types/` (ignored by git).

## License

MIT
