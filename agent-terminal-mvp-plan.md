# Agent Terminal for macOS — MVP Plan

**Status:** DRAFT — awaiting confirmation. No code is written until this plan is approved.
**Target platform:** macOS (Apple Silicon first, Intel optional)
**Inspiration:** BridgeSpace (multi-panel agent terminal), cmux (attention-aware native terminal)
**Chosen approach:** Option A — Electron + xterm.js + node-pty (fastest path to a working MVP in TypeScript)

---

## 1. Goal

Build a personal macOS terminal workspace where I can run several AI coding agents (Claude Code, Codex, and others) side by side, see at a glance which agent needs attention, and restore my whole setup after a restart.

### MVP success criteria
The MVP is done when all of these are true:

1. I can open a workspace with a grid of 1–9 terminal panels and each panel runs an independent shell.
2. I can attach a project folder and an agent command to each panel and launch it with one action.
3. I get a macOS notification and a visual indicator when an agent finishes or is waiting for my input.
4. After quitting and reopening the app, the layout, folders, and agent assignments are restored.
5. I use it daily for one week instead of my current terminal without falling back to it because of bugs.

### Non-goals (explicitly NOT in the MVP)
- Warp-style command blocks (needs deep shell integration; high complexity)
- Built-in browser panel
- Built-in IDE or code editor
- Kanban board
- Orchestrator agent that controls other agents
- Windows/Linux support
- Cloud sync, accounts, licensing, auto-update
- Distribution to other users (no Apple Developer signing/notarization in MVP)

---

## 2. Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Shell/app framework | Electron (latest stable) | Known TypeScript ecosystem, fastest MVP |
| Build tooling | electron-vite + TypeScript (strict) | Single config for main/preload/renderer |
| UI | React + plain CSS (CSS grid) | Simple panel layout, minimal dependencies |
| Terminal rendering | xterm.js with `fit`, `webgl`, `serialize`, `search` addons | Industry standard (used by VS Code) |
| PTY | node-pty | Real pseudo-terminals; requires native rebuild for Electron |
| State storage | JSON file via electron-store (or a plain JSON file in app data) | Enough for layout/session persistence |
| Notifications | Electron `Notification` API + dock badge | Native macOS notifications |
| Packaging | electron-builder, local unsigned build | Personal use only |
| Lint/format | ESLint + Prettier | Keep the codebase clean from day one |

**Note:** exact versions to be pinned at project setup. node-pty must be rebuilt against the Electron ABI (`@electron/rebuild`); this is a known setup step and a common source of first-day build failures.

---

## 3. Architecture

### 3.1 Process model

```
┌──────────────────────────────────────────────┐
│ Main process (Node)                          │
│  - Window management                         │
│  - PTY manager (node-pty instances)          │
│  - Agent state tracker                       │
│  - Notification service                      │
│  - Persistence service                       │
│  - Local hook receiver (agent events)        │
└───────────────▲──────────────────────────────┘
                │ IPC (typed, via preload)
┌───────────────▼──────────────────────────────┐
│ Renderer process (React)                     │
│  - Workspace grid                            │
│  - Panel components (xterm.js instances)     │
│  - Panel header (project, agent, status)     │
│  - Sidebar / panel list                      │
└──────────────────────────────────────────────┘
```

### 3.2 Security rules
- `contextIsolation: true`, `nodeIntegration: false` in the renderer.
- The renderer talks to the main process only through a narrow, typed API exposed in the preload script.
- No remote content is loaded in the app window.
- The hook receiver (see 5.3) listens on a Unix domain socket or `127.0.0.1` only, never on external interfaces.

### 3.3 Project structure (proposed)

```
agent-terminal/
├─ src/
│  ├─ main/
│  │  ├─ index.ts              # app bootstrap
│  │  ├─ pty-manager.ts        # spawn/resize/kill/write
│  │  ├─ agent-tracker.ts      # status state machine
│  │  ├─ hook-server.ts        # receives agent events
│  │  ├─ notifications.ts
│  │  ├─ persistence.ts
│  │  └─ ipc.ts                # IPC handler registration
│  ├─ preload/
│  │  └─ index.ts              # typed API bridge
│  ├─ renderer/
│  │  ├─ App.tsx
│  │  ├─ components/
│  │  │  ├─ WorkspaceGrid.tsx
│  │  │  ├─ TerminalPanel.tsx
│  │  │  ├─ PanelHeader.tsx
│  │  │  └─ Sidebar.tsx
│  │  ├─ state/                # lightweight store (e.g., Zustand)
│  │  └─ styles/
│  └─ shared/
│     └─ types.ts              # IPC contracts, data models
├─ resources/                  # icons
├─ electron.vite.config.ts
├─ package.json
└─ README.md
```

---

## 4. Data Model

```ts
type AgentKind = "none" | "claude" | "codex" | "custom";

type PanelStatus =
  | "idle"          // shell open, no agent running
  | "running"       // agent actively working
  | "waiting"       // agent needs user input / permission
  | "done"          // agent finished its task
  | "exited"        // process ended
  | "error";        // process crashed or failed to start

interface PanelConfig {
  id: string;
  title: string;
  cwd: string;               // project folder
  agent: AgentKind;
  agentCommand?: string;     // e.g. "claude", for custom agents
  shell: string;             // default: user's $SHELL
  env?: Record<string, string>;
}

interface WorkspaceConfig {
  id: string;
  name: string;
  layout: { rows: number; cols: number };
  panels: PanelConfig[];
  panelOrder: string[];
}

interface AppState {
  workspaces: WorkspaceConfig[];
  activeWorkspaceId: string;
  window: { x: number; y: number; width: number; height: number };
  schemaVersion: number;
}
```

`schemaVersion` is included from the start so future migrations are possible.

---

## 5. Feature Specifications

### 5.1 Feature 1 — Panel grid and independent shells

**Behavior**
- A workspace shows a grid (rows × cols) of panels. Presets: 1×1, 1×2, 2×2, 2×3, 3×3.
- Each panel owns one PTY and one xterm.js instance.
- Panels can be focused by click or keyboard shortcut (`Cmd+1…9`, `Cmd+Arrow` to move focus).
- Maximize/restore a single panel (`Cmd+Enter`) without killing the others.
- Closing a panel kills its PTY (with confirmation if a process is running).
- Resizing the window refits all terminals and sends the new size to each PTY.

**Technical notes**
- Use the xterm.js `fit` addon and a `ResizeObserver` per panel; debounce resize events.
- PTY spawn uses the user's login shell with `-l` so PATH and aliases behave like a normal terminal.
- Set `TERM=xterm-256color` and `COLORTERM=truecolor`.
- PTY output is streamed to the renderer over IPC in chunks, batched on a short interval to avoid flooding.

**Acceptance criteria**
- 9 panels open simultaneously; typing in one never affects another.
- Window resize keeps text layout correct (verify with `vim` and `htop`).
- Closing one panel does not affect the others.

### 5.2 Feature 2 — Project and agent attachment with one-action launch

**Behavior**
- Each panel has a header showing: title, project folder, agent badge, status indicator.
- "New panel" dialog lets me choose: folder (native folder picker), agent (None / Claude Code / Codex / Custom), optional extra arguments.
- A **Launch** action types the agent command into the panel's shell (`cd <cwd> && <agent>`), so the agent runs inside a normal shell and I keep the shell after the agent exits.
- A **Restart agent** action stops the agent (Ctrl+C) and relaunches it.
- Workspace templates: save the current set of panels as a template (e.g., "Backend + Frontend + Tests") and re-open it later.

**Technical notes**
- Agent commands are stored as configurable strings, so new agents need no code change.
- Do not hardcode paths; resolve agent binaries through the login shell PATH.
- The panel's `cwd` is set when spawning the PTY, not by typing `cd`, to keep the visible history clean.

**Acceptance criteria**
- Creating a panel with a folder and agent, then pressing Launch, starts the agent in the right directory.
- Custom agent command works (e.g., any CLI tool).
- A saved template re-creates the same panels and folders.

### 5.3 Feature 3 — Agent status detection and notifications

This is the highest-risk feature; it gets the most careful design.

**Two detection strategies, used in priority order**

1. **Hooks (primary, reliable).** Claude Code supports hooks configured in its settings that run a command on events such as a notification request or task completion. The app provides a tiny helper script that posts `{panelId, event}` to the app's local hook receiver. Each panel's environment includes `AGENT_TERMINAL_PANEL_ID` and the socket path so the helper knows which panel the event belongs to.
   - Event mapping (to be verified against current Claude Code docs during setup): "needs attention/permission" → `waiting`; "stop/finished" → `done`.
   - Codex and other agents: check whether they offer an equivalent notify/hook mechanism; if so, add an adapter per agent.
2. **Output heuristics (fallback, fragile).** For agents without hooks: treat sustained PTY output as `running`, and a quiet period (e.g., N seconds without output) after activity as `done`/`waiting`. This is a guess and will produce false positives; it must be clearly labeled as "heuristic" in the code.

**State machine**

```
idle ──launch──▶ running ──hook:waiting──▶ waiting ──user input──▶ running
                    │                                              │
                    └────hook:done──▶ done ◀──────────────────────┘
any ──process exit──▶ exited (code 0) | error (non-zero)
```

**Notification rules**
- Notify only when the app window is not focused, or when the panel is not the focused panel.
- One notification per state transition (no spam); coalesce multiple events within a short window.
- Clicking a notification focuses the app and the relevant panel.
- Dock badge shows the count of panels in `waiting`/`done` that I have not yet visited.
- Panel header and sidebar show a colored status dot; unread panels get a visible ring/highlight.
- Visiting (focusing) a panel clears its unread state.

**Acceptance criteria**
- With Claude Code in a background panel, finishing a task produces a notification and highlights the panel.
- Permission prompts produce a `waiting` state and notification.
- Clicking the notification focuses the correct panel.
- No notification storm when an agent prints a lot of output.

### 5.4 Feature 4 — Session persistence and restore

**What is restored**
- Workspaces, layouts, panel configs (title, folder, agent), window size/position, active workspace.
- Optionally: scrollback of each terminal (via xterm.js `serialize` addon), capped (e.g., last 2,000 lines per panel).

**What is NOT restored (important to be honest about)**
- Running processes. A PTY cannot survive an app quit; on restore, panels reopen as fresh shells in the right folder with the agent ready to launch (not auto-launched by default).
- Agent conversation state is the agent's own responsibility (e.g., Claude Code's own resume features); the app may offer a "launch with resume" argument per agent as a later improvement.

**Technical notes**
- Persist on meaningful changes (debounced) and on quit.
- Write atomically (write temp file, then rename) to avoid corruption.
- Validate loaded JSON against `schemaVersion`; on failure, back up the broken file and start with defaults.

**Acceptance criteria**
- Quit and reopen: same layout, same folders, same agent assignments.
- Corrupted state file does not crash the app.

---

## 6. Performance and Resource Budget

- Target: 9 simultaneous panels with smooth typing and scrolling on an Apple Silicon Mac.
- Use the xterm.js WebGL renderer; fall back to canvas/DOM if WebGL context is lost.
- Cap scrollback per terminal (start with 5,000 lines; make it configurable).
- Batch PTY output to the renderer (e.g., flush every ~8–16 ms) with a size limit per flush.
- Apply backpressure: pause PTY reading if the renderer is overwhelmed.
- Pause rendering work for hidden panels (maximized-view or other workspace).
- Measure early: record idle and loaded memory/CPU in the first milestone and set a budget (to be decided after the first measurement, not guessed now).

---

## 7. Keyboard Shortcuts (initial)

| Action | Shortcut |
|---|---|
| New panel | `Cmd+N` |
| Close panel | `Cmd+W` |
| Focus panel 1–9 | `Cmd+1…9` |
| Move focus | `Cmd+Option+Arrow` |
| Maximize/restore panel | `Cmd+Enter` |
| Next unread panel | `Cmd+U` |
| Switch workspace | `Cmd+Shift+[` / `]` |
| Search in terminal | `Cmd+F` |

Care is needed so app shortcuts do not swallow keys that terminal programs need (e.g., `Ctrl+C`, `Ctrl+R`, `Ctrl+A/E`).

---

## 8. Milestones

Estimates assume part-time work and use of Claude Code for implementation. They are rough and should be revisited after Milestone 1.

### Milestone 0 — Project setup (0.5–1 day)
- Scaffold electron-vite + React + TypeScript project.
- Get node-pty building against Electron (rebuild script).
- Single window showing one working xterm.js terminal.
- **Exit check:** can run `ls`, `vim`, `htop` correctly in the single terminal.

### Milestone 1 — Multi-panel grid (2–3 days)
- PTY manager (spawn, write, resize, kill) with typed IPC.
- Workspace grid with layout presets, focus handling, maximize.
- Resize handling with debounce.
- **Exit check:** 9 panels, independent shells, correct resizing. Record baseline memory/CPU.

### Milestone 2 — Project and agent attachment (2–3 days)
- New panel dialog with folder picker and agent selection.
- Panel header with title, folder, agent badge.
- Launch / restart agent actions; custom agent command.
- Workspace templates (save/load).
- **Exit check:** can launch Claude Code in two different project folders from two panels.

### Milestone 3 — Status and notifications (3–5 days)
- Agent tracker state machine.
- Hook receiver and helper script; Claude Code hook setup instructions.
- Heuristic fallback for non-hook agents.
- Notifications, dock badge, unread highlighting, click-to-focus.
- **Exit check:** real-world test with a long Claude Code task running in a background panel.

### Milestone 4 — Persistence (1–2 days)
- Atomic state saving and loading, schema versioning, corruption recovery.
- Optional scrollback restore.
- **Exit check:** quit/reopen cycle restores everything listed in 5.4.

### Milestone 5 — Hardening and daily-use trial (3–5 days + 1 week of use)
- Keyboard shortcuts, search, theming (one dark and one light theme).
- Error handling (missing folder, missing agent binary, PTY spawn failure).
- Local packaged build (`.app`) installed in `/Applications`.
- One-week daily-use trial; keep a bug list.
- **Exit check:** success criteria in section 1 are met.

**Rough total:** 2–3 weeks of focused work to a usable MVP, plus the trial week.

---

## 9. Testing Strategy

- **Unit tests** (Vitest): state machine transitions, persistence load/save/migration, IPC payload validation.
- **Integration tests:** spawn a PTY running a scripted fake agent (a small script that prints, pauses, and emits hook events) to test status detection without needing a real agent.
- **Manual test checklist** per milestone: `vim`, `htop`, `less`, long output (`yes | head -n 1000000`), unicode/emoji, resizing, copy/paste, Ctrl+C handling.
- **Soak test:** run 9 panels for several hours with agents active; watch for memory growth and PTY leaks.

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| node-pty fails to build for Electron | Blocks everything | Milestone 0 is dedicated to this; pin versions; use `@electron/rebuild` |
| Output-parsing for agent status is unreliable | Wrong/missing notifications | Hooks as primary strategy; heuristics only as labeled fallback |
| Agent hook formats change | Notifications break silently | Isolate each agent in an adapter; document verified versions; add a visible "hooks not detected" warning |
| 9 Electron terminals feel heavy | Poor daily experience | WebGL renderer, scrollback caps, output batching, early measurement in Milestone 1 |
| App shortcuts conflict with terminal keys | Annoying, breaks workflows | Review each shortcut; make them configurable early |
| Scope creep toward BridgeSpace feature set | MVP never ships | Non-goals list in section 1; new ideas go to a backlog, not the MVP |
| Persisted state corruption | Lost layout | Atomic writes, backup on failure, schema versioning |
| Duplicating existing tools | Wasted effort | Honest checkpoint after Milestone 2: compare against cmux; if my needs are met there, reconsider forking it instead |

---

## 11. Backlog (after MVP, in rough priority order)

1. Built-in browser panel (preview localhost apps)
2. SSH/remote workspaces
3. Git worktree per panel for parallel agents on one repo
4. Command blocks via shell integration
5. Kanban/task board linked to panels
6. Agent orchestration (one agent coordinating others)
7. Code signing, notarization, and auto-update (only if distributing)

---

## 12. Open Questions (to confirm before coding)

1. Is this for **personal use only** or a **product to distribute/sell**? (Affects signing, licensing, polish.)
2. Which agents must be supported on day one besides Claude Code? (Codex, Gemini CLI, others.)
3. Should agents auto-launch on app start, or only on explicit action? (Plan default: explicit action.)
4. Is a one-week daily-use trial an acceptable definition of done?
5. Should I first fork cmux as a cheaper alternative if the missing pieces are small?

---

## 13. Confirmation Gate

Per the working agreement, **no code will be written until this plan is explicitly approved.**

To proceed, confirm:
- [ ] Approach A (Electron + xterm.js + node-pty) is approved
- [ ] MVP scope (section 1) and non-goals are approved
- [ ] Milestone order (section 8) is approved
- [ ] Answers to open questions (section 12) are provided

After approval, work starts at **Milestone 0**.
