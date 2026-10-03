# Agent Terminal (`myterm`)

Multi-panel macOS terminal workspace for running AI coding agents (Claude Code, Codex, and others) side by side with attention-aware status tracking, native macOS notifications, and session persistence.

---

## Features

- **Multi-panel Grid:** 1–9 independent shell panels in preset layouts (1×1, 1×2, 2×2, 2×3, 3×3).
- **Independent PTY Sessions:** Native `node-pty` instances running the panel's login shell (default: your account's shell) with full environment, PATH, and UTF-8 / truecolor support.
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
npm test
```

### Production Build
```bash
npm run build
```

### Package macOS App
```bash
npm run package
```

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