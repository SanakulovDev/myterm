# Agent Terminal (`myterm`)

Multi-panel macOS terminal workspace for running AI coding agents (Claude Code, Codex, and others) side by side with attention-aware status tracking, native macOS notifications, and session persistence.

---

## Features

- **Multi-panel Grid:** 1–9 independent shell panels in preset layouts (1×1, 1×2, 2×2, 2×3, 3×3).
- **Independent PTY Sessions:** Native `node-pty` instances running the panel's login shell (default: your account's shell) with your environment, PATH, and UTF-8 / truecolor support (see [Terminal Behavior](#terminal-behavior)).
- **Agent Lifecycle & One-Action Launch:** Attach project folders and coding agents (Claude Code, Codex) to panels; the agent starts automatically when the panel is created, and the panel header has Launch / Restart buttons.
- **Attention & Status Tracking:**
  - `idle`, `running`, `waiting`, `done`, `exited`, `error` states.
  - Primary strategy: Unix domain socket hook receiver (`AGENT_TERMINAL_SOCKET`).
  - Auto-launch reports `running` while the agent runs and `idle` once it exits. `waiting` / `done` come only from hooks (the output-quiet heuristic is disabled).
  - Native macOS notifications and dock badge unread count.
  - Unread pulse rings around panels needing attention.
- **Session Persistence:** Atomic state saving and corruption recovery (`workspace-state.json`), restoring workspaces, panel layouts, folders, and scrollback.
- **Workspace Templates:** Save multi-panel setups (e.g. Backend + Frontend + Agent) and launch them anytime.
- **In-Terminal Search:** Built-in search overlay (`Cmd+F`).

---

## Getting Started

### Development
```bash
npm run dev
```

### Run Tests
```bash
npm test            # unit tests
npm run test:e2e    # end-to-end tests: builds a test build into out-e2e/, then drives it
```

### Production Build
```bash
npm run build
node scripts/check-release.mjs   # production build into a temp dir; fails if any test hook is in it
```

### Package macOS App
```bash
npm run package
```

`npm run package` builds, checks the build for test hooks, and packages the app. Its `afterPack` step (`scripts/after-pack.cjs`) then turns the `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` Electron fuses off, re-signs the app ad hoc, and fails the package if a fuse is still on or a test hook is in `app.asar`. Check an existing app with `node scripts/check-release.mjs --app "dist/mac-arm64/Agent Terminal.app"`.

### Test Hooks

The end-to-end tests drive the app through the Chromium remote debugging port (renderer) and the Node inspector (main process), and read internals through `window.__myterm`, `globalThis.__mytermMain` and `MYTERM_DEBUG`. These exist only in `npm run dev` and in test builds (`MYTERM_TEST_HOOKS=1`, as `npm run test:e2e` does). A release build compiles them out, which `scripts/check-release.mjs` verifies. A packaged app also exits at startup when given `--remote-debugging-port` or `--remote-debugging-pipe`, and ignores `--inspect`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE` because of the fuses.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd + N` | New terminal panel |
| `Cmd + W` | Close focused panel |
| `Cmd + 1…9` | Focus panel 1–9 |
| `Cmd + Option + Arrow` | Move focus across panels |
| `Cmd + Enter` | Maximize / restore panel |
| `Cmd + U` | Jump to next unread / waiting panel |
| `Cmd + Shift + [` / `]` | Switch between workspaces |
| `Cmd + F` | Search in active terminal |

### Inside a terminal

| Key | Sends | Use |
|---|---|---|
| `Shift + Enter` | `ESC CR` | New line in an agent prompt (Claude Code) without submitting |
| `Option + Left` / `Right` | `ESC b` / `ESC f` | Word left / right |
| `Cmd + Left` / `Right` | `Ctrl+A` / `Ctrl+E` | Line start / end |
| `Cmd + Backspace` | `Ctrl+U` | Delete to line start |
| `Option + key` | `ESC key` | Option acts as Meta (Option+click still selects in mouse-mode programs) |

---

## Terminal Behavior

Panels aim to behave like a native macOS terminal (Ghostty, cmux) for the programs in them:

- **Font:** JetBrains Mono 13px, bundled with the app (`@fontsource/jetbrains-mono`), line height 1.0, so box drawing and agent logos join up. Glyphs the font lacks fall back to SF Mono, Menlo, Monaco.
- **Character widths:** Unicode 11 tables (`@xterm/addon-unicode11`): emoji and newer symbols take two cells, as agent TUIs assume.
- **Links:** `Cmd + click` opens a URL, plain or an OSC 8 hyperlink, in the default browser. A plain click never opens anything. Only `http:` and `https:` URLs are opened; the main process refuses everything else, from any source.
- **File drop:** dropping files or folders on a terminal types their paths at the cursor, shell-escaped and separated by spaces, as a paste. Agents that accept pasted image paths (Claude Code) attach them. A drop anywhere else does nothing; the window never navigates away.
- **Environment:** programs see `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=myterm` and `TERM_PROGRAM_VERSION=<app version>`. When the app itself was started from another terminal or a Claude Code session (for example `npm run dev` inside cmux), that session's variables are not passed on (full list in `src/main/terminal-env.ts`), among them `TERM_PROGRAM*`, `TERMINFO`, `CMUX_*`, `GHOSTTY_*`, `ITERM_*`, `KITTY_*`, `WEZTERM_*`, `VSCODE_*`, `TMUX*`, `CLAUDECODE`, `CLAUDE_PID`, the Claude Code session variables, and PATH entries those variables point to (cmux's `claude` wrapper shims, for example). Everything else, including your own `CLAUDE_CODE_*` settings, passes through.

---

## Agent Auto-Launch

A panel created from the **New Panel** dialog with an agent starts that agent right away. Panels restored when the app reopens start a plain shell; use the header **Launch** button to start the agent again.

How it runs:

- The panel's shell is started as `<shell> -l -i -c <launch script>`, so `.zprofile` **and** `.zshrc` are read and the agent sees the same PATH as your normal terminal (nvm, pyenv, Homebrew, …).
- The script checks the command with `command -v` in that same shell. If it is missing, the panel prints a banner naming the command and you get a normal shell (status `idle`).
- When the agent exits, the script replaces itself with an interactive login shell (`exec <shell> -l`), so the panel stays usable. Status goes back to `idle` with the exit code.
- **Ctrl+C** goes to the agent as usual. If the agent exits because of it, the shell still appears (status detail: "Agent interrupted").
- **Launch / Restart** in the panel header restart the panel's shell and start the agent again. Anything else running in that panel's shell is stopped.
- The agent command, its arguments and the folder are never pasted into the script text, so folders with spaces, quotes or apostrophes are safe.

Limits:

- **Extra arguments are split on whitespace.** Quotes are not interpreted and wildcards are not expanded, so `--model "big model"` becomes three arguments. Put such values in the agent's own config instead.
- **The agent command must be a program or shell function on PATH, or a full path.** Shell aliases are not supported. Use the alias target, for example `/Users/me/.claude/local/claude` instead of an alias named `claude`.
- **Auto-launch needs a POSIX shell** (zsh, bash, sh, dash, ksh). With fish or nu, the panel opens a plain shell with a notice and the agent is not started.
- The agent's command and arguments are separate settings. Put flags in **Extra Arguments**, not in the command field.

---

## Closing and Quitting

- **The red close button hides the window.** The app, the terminals and every running agent keep running in the background, at full speed. Click the Dock icon to show the same window again: nothing restarts and no output is lost.
- **Cmd+Q (or Dock > Quit) quits** and stops every terminal. Changed terminal output is saved first.
- If any panel is running something, Cmd+Q asks first and names each panel and its process. **Cancel** keeps everything running. With only idle shells, the app quits without asking.
- **Logout, restart and shutdown never wait on that question.** The app quits right away and saves output. This uses the system's power-off notification (`powerMonitor` `shutdown`), which also closes a question that is already open. `SIGTERM`, `SIGHUP` and `SIGINT` (for example `kill <pid>`, or closing the terminal that runs `npm run dev`) quit the same way.
- **Force Quit and `kill -9` save nothing.** Output is lost back to the last autosave, at most about 30 seconds.

### What counts as "running"

A panel counts as running when:

- an agent started with **Launch** (or from the New Panel dialog) has not exited yet, or
- any command is in the foreground of the panel's shell: an agent you typed yourself (`claude`), a script, a build, `vim`, `less`, `ssh`, `sleep`, and so on.

Foreground detection asks `ps` for the terminal's foreground process group (`tpgid`) and compares it with the shell's own process. The shell and process names are not used, so `sh script.sh`, `bash -c …` and agents with any name are all counted. An idle shell at its prompt never counts.

Limits:

- **Background jobs are not counted.** A command started with `&`, or suspended with Ctrl+Z, does not trigger the question.
- **Every foreground program counts**, including an open editor or pager with nothing to lose.
- The process name in the question is the kernel's short name (at most 16 characters). A shell script started by hand can show as `bash`.
- If `ps` fails, only agents started with **Launch** count, and a warning is logged.

---

## Saved Terminal Output

> **Privacy:** Terminal output is saved **unencrypted** on disk. It can contain secrets: API keys, tokens, passwords typed at a visible prompt, or anything a command printed. Anyone who can read your user account's files can read it.

- Location: `~/Library/Application Support/myterm/scrollbacks/<panel id>.log`, up to the last 5000 lines of each panel, in xterm.js serialized form (text plus escape codes).
- The `scrollbacks` folder is readable only by your user (mode `0700`). Each output file, `workspace-state.json` and its backups are mode `0600`. Existing files get these modes when the app starts.
- Output is saved every 30 seconds for panels whose output changed, when the window is hidden, and when the app quits. Each file is written to a temp file and renamed into place, so a crash never leaves a half-written file.
- **Closing a panel deletes its saved output.** Leftover files of panels that no longer exist are removed the next time the app starts.
- There is no "remove workspace" action yet. Panels closed one by one delete their output as above.
- To remove all saved output, quit the app and delete the `scrollbacks` folder.

---

## Agent Hook Setup (Claude Code / Custom CLI)

Each terminal panel exports two environment variables:
- `AGENT_TERMINAL_PANEL_ID`: The unique ID of the panel.
- `AGENT_TERMINAL_SOCKET`: Unix domain socket path for posting events.

You can notify the terminal workspace manually or from scripts using the included helper:
```bash
./resources/agent-hook.sh waiting "Waiting for permission"
./resources/agent-hook.sh done "Task completed successfully"
```
Or directly via `curl`:
```bash
curl --unix-socket "$AGENT_TERMINAL_SOCKET" -X POST http://localhost/event \
  -H "Content-Type: application/json" \
  -d '{"panelId":"'"$AGENT_TERMINAL_PANEL_ID"'","event":"waiting","detail":"Approval required"}'
```