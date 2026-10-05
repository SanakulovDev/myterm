import { ElectronAPI, LaunchSpec, PanelConfig } from '../../../shared/types'
import { NO_AGENT, promptFlag } from '../../../shared/agents'
import { Disposable, WebglBudget } from './webgl-budget'
import { whenIdle } from './idle'

// Terminal sessions live outside React. A panel's session (xterm, addons, host
// element) is created the first time the panel is shown and destroyed only when
// the panel is closed. Unmounting a panel (workspace switch) only parks its
// host element, so the PTY, the agent and the full terminal state survive.
//
// One PTY is spawned per session. Workspace switches, maximize/restore and
// React remounts never spawn or kill a PTY; only Launch/Restart (explicit) and
// a changed cwd/shell respawn it, as before.
//
// Scrollback is saved to disk when a panel's output changed: every
// AUTOSAVE_INTERVAL_MS, when the window hides, and when the app quits.

export const AUTOSAVE_INTERVAL_MS = 30_000

// Between a pasted prompt and the Enter that submits it. Agent TUIs handle a
// paste asynchronously; an Enter in the same chunk can land inside the paste.
export const PROMPT_SUBMIT_DELAY_MS = 120

/** What the registry needs from one xterm instance (see xterm-handle.ts). */
export interface TerminalHandle {
  readonly cols: number
  readonly rows: number
  /** Moves the host element into `container`; opens xterm on the first call. */
  mountIn(container: HTMLElement): void
  /** Moves the host element into the hidden parking lot. */
  park(): void
  write(data: string): void
  /** Types `text` as a paste (bracketed when the program asked for it). */
  paste(text: string): void
  onData(listener: (data: string) => void): void
  /** Fits to the container. Returns false when the container has no usable size. */
  fit(): boolean
  /** Redraws every row (needed after a renderer swap). */
  refresh(): void
  focus(): void
  serialize(): string
  findNext(text: string): boolean
  findPrevious(text: string): boolean
  /** Loads a WebGL renderer, or returns null when WebGL is unavailable. */
  attachWebgl(onContextLoss: () => void): Disposable | null
  debugInfo(): TerminalDebugInfo
  dispose(): void
}

export interface TerminalDebugInfo {
  cols: number
  rows: number
  fontFamily: string
  fontSize: number
  unicodeVersion: string
  cursorX: number
  cursorY: number
  bufferLength: number
  text: string
}

export type TerminalApi = Pick<
  ElectronAPI,
  | 'spawnPty'
  | 'writePty'
  | 'resizePty'
  | 'onPtyData'
  | 'loadScrollback'
  | 'saveScrollback'
  | 'deleteScrollback'
>

export interface TerminalRegistryDeps {
  api: TerminalApi
  createTerminal: () => TerminalHandle
  budget: WebglBudget
  /** Resolves when background work may run (default: whenIdle). */
  idle?: () => Promise<void>
}

interface Session {
  id: string
  term: TerminalHandle
  panel: PanelConfig
  visible: boolean
  // Set once the first PTY spawn has been requested (initial or Launch).
  started: boolean
  spawns: number
  spawned: { cwd: string; shell: string }
  ptySize: { cols: number; rows: number }
  // PTY output arrived since the last successful save started.
  dirty: boolean
}

export interface SessionDebugInfo {
  id: string
  visible: boolean
  attached: boolean
  webgl: boolean
  spawns: number
  dirty: boolean
}

/**
 * How a panel's agent is launched. A first prompt is passed only to agents
 * known to take one; others start without it.
 */
export function getLaunchSpec(panel: PanelConfig, prompt?: string): LaunchSpec | undefined {
  if (panel.agent === NO_AGENT) return undefined
  const command = panel.agentCommand?.trim() || panel.agent
  const spec: LaunchSpec = { command, args: panel.agentArgs }
  const flag = promptFlag(panel.agent)
  if (prompt?.trim() && flag !== undefined) {
    spec.prompt = prompt
    spec.promptFlag = flag
  }
  return spec
}

export class TerminalRegistry {
  private readonly sessions = new Map<string, Session>()
  // Containers of mounted panels, kept even before their session exists.
  private readonly containers = new Map<string, HTMLElement>()
  // Panels just created (New Panel, a lineup, the command bar) whose first
  // spawn launches the agent, with its first prompt if any. In memory only,
  // so restored panels never auto-launch.
  private readonly pendingLaunch = new Map<string, string | undefined>()
  private unsubscribeData: (() => void) | null = null
  private autosaveTimer: ReturnType<typeof setInterval> | null = null
  private autosaving = false
  // Scrollback saves still in flight; a flush waits for them too.
  private readonly saving = new Set<Promise<void>>()

  constructor(private readonly deps: TerminalRegistryDeps) {}

  markLaunchPending(id: string, prompt?: string): void {
    this.pendingLaunch.set(id, prompt)
  }

  isLaunchPending(id: string): boolean {
    return this.pendingLaunch.has(id)
  }

  /** A panel mounted with `container` as its terminal slot. */
  attach(id: string, container: HTMLElement): void {
    this.containers.set(id, container)
    this.sessions.get(id)?.term.mountIn(container)
  }

  /** The panel that owned `container` unmounted. Its session keeps running. */
  detach(id: string, container: HTMLElement): void {
    // A newer mount may already own the panel; leave it alone.
    if (this.containers.get(id) !== container) return
    this.containers.delete(id)
    const session = this.sessions.get(id)
    if (!session) return
    this.hide(session)
    session.term.park()
  }

  /**
   * Shows or hides an attached panel. The first show creates the session and
   * spawns its PTY; a hidden panel never creates one.
   */
  setVisible(panel: PanelConfig, visible: boolean): void {
    let session = this.sessions.get(panel.id)
    if (!visible) {
      if (session) this.hide(session)
      return
    }
    const container = this.containers.get(panel.id)
    if (!container) return
    if (!session) session = this.create(panel, container)
    if (session.visible) return

    session.visible = true
    this.deps.budget.acquire(session.id, () =>
      session.term.attachWebgl(() => this.deps.budget.release(session.id))
    )
    this.refit(session)
    session.term.refresh()
  }

  /** Refits a visible panel to its container (window or layout resize). */
  fit(id: string): void {
    const session = this.sessions.get(id)
    if (session?.visible) this.refit(session)
  }

  /** Refits all visible panels to their containers. */
  fitAll(): void {
    for (const session of this.sessions.values()) {
      if (session.visible) this.refit(session)
    }
  }

  focus(id: string): void {
    const session = this.sessions.get(id)
    if (session?.visible) session.term.focus()
  }

  findNext(id: string, text: string): void {
    this.sessions.get(id)?.term.findNext(text)
  }

  findPrevious(id: string, text: string): void {
    this.sessions.get(id)?.term.findPrevious(text)
  }

  /**
   * Header Launch / Restart: respawns the PTY through the launch script (main
   * kills the current shell or agent first) and keeps the terminal as is.
   */
  launch(panel: PanelConfig, prompt?: string): void {
    const session = this.sessions.get(panel.id)
    const launch = getLaunchSpec(panel, prompt)
    if (!session || !launch) return
    session.panel = panel
    session.term.write(`\r\n\x1b[90m[Agent Terminal] Starting ${launch.command}\x1b[0m\r\n`)
    void this.spawn(session, launch)
  }

  /** Respawns the PTY when the panel's cwd or shell changed since its spawn. */
  syncSpawnConfig(panel: PanelConfig): void {
    const session = this.sessions.get(panel.id)
    if (!session) return
    session.panel = panel
    if (!session.started) return
    if (panel.cwd === session.spawned.cwd && panel.shell === session.spawned.shell) return
    void this.spawn(session, this.pendingSpec(panel))
  }

  /**
   * Types `text` into the panel's running program as one paste, then presses
   * Enter when `submit`. Returns false when the panel has no terminal yet.
   */
  sendPrompt(id: string, text: string, submit = true): boolean {
    const session = this.sessions.get(id)
    if (!session?.started || !text) return false
    session.term.paste(text)
    if (submit) {
      setTimeout(() => {
        if (this.sessions.get(id) === session) this.deps.api.writePty(id, '\r')
      }, PROMPT_SUBMIT_DELAY_MS)
    }
    return true
  }

  /** The panel was closed. The caller kills its PTY. Its saved output goes too. */
  destroy(id: string): void {
    this.pendingLaunch.delete(id)
    this.containers.delete(id)
    const session = this.sessions.get(id)
    if (session) {
      this.sessions.delete(id)
      this.deps.budget.release(id)
      session.term.dispose()
    }
    // Main runs it after any save of this panel already sent.
    this.deps.api.deleteScrollback(id).catch(() => false)
  }

  /** Starts the periodic autosave. Returns a function that stops it. */
  startAutosave(intervalMs = AUTOSAVE_INTERVAL_MS): () => void {
    if (!this.autosaveTimer) {
      this.autosaveTimer = setInterval(() => void this.autosave(), intervalMs)
    }
    return () => {
      if (this.autosaveTimer) clearInterval(this.autosaveTimer)
      this.autosaveTimer = null
    }
  }

  /**
   * One autosave pass. Each changed session is saved in its own idle slot,
   * so typing never waits behind a large serialization.
   */
  async autosave(): Promise<void> {
    if (this.autosaving) return
    this.autosaving = true
    try {
      for (const session of Array.from(this.sessions.values())) {
        if (!session.dirty) continue
        await (this.deps.idle ?? whenIdle)()
        if (this.sessions.get(session.id) !== session || !session.dirty) continue
        await this.save(session)
      }
    } finally {
      this.autosaving = false
    }
  }

  /** Saves every changed session now (window hidden, app quitting). */
  async flushScrollback(): Promise<void> {
    const inFlight = Array.from(this.saving)
    const saves = Array.from(this.sessions.values())
      .filter((session) => session.dirty)
      .map((session) => this.save(session))
    await Promise.all([...inFlight, ...saves])
  }

  debugSessions(): SessionDebugInfo[] {
    return Array.from(this.sessions.values(), (session) => ({
      id: session.id,
      visible: session.visible,
      attached: this.containers.has(session.id),
      webgl: this.deps.budget.has(session.id),
      spawns: session.spawns,
      dirty: session.dirty
    }))
  }

  debugTerminal(id: string): (TerminalDebugInfo & { serialized: string }) | null {
    const session = this.sessions.get(id)
    if (!session) return null
    return { ...session.term.debugInfo(), serialized: session.term.serialize() }
  }

  get webglCount(): number {
    return this.deps.budget.size
  }

  private create(panel: PanelConfig, container: HTMLElement): Session {
    this.ensureDataRouter()
    const term = this.deps.createTerminal()
    const session: Session = {
      id: panel.id,
      term,
      panel,
      visible: false,
      started: false,
      spawns: 0,
      spawned: { cwd: panel.cwd, shell: panel.shell },
      ptySize: { cols: 0, rows: 0 },
      dirty: false
    }
    this.sessions.set(panel.id, session)

    term.mountIn(container)
    term.fit()
    term.onData((data) => this.deps.api.writePty(panel.id, data))
    void this.start(session)
    return session
  }

  // Restores saved scrollback, then spawns the PTY, so the old output always
  // lands above the new shell's first prompt.
  private async start(session: Session): Promise<void> {
    let saved: string | null = null
    try {
      saved = await this.deps.api.loadScrollback(session.id)
    } catch {
      // A missing or unreadable scrollback file only loses old output.
    }
    if (this.sessions.get(session.id) !== session || session.started) return
    if (saved) session.term.write(saved)

    await this.spawn(session, this.pendingSpec(session.panel))
  }

  private pendingSpec(panel: PanelConfig): LaunchSpec | undefined {
    if (!this.pendingLaunch.has(panel.id)) return undefined
    return getLaunchSpec(panel, this.pendingLaunch.get(panel.id))
  }

  private async spawn(session: Session, launch: LaunchSpec | undefined): Promise<void> {
    const { panel, term } = session
    session.started = true
    session.spawns++
    session.spawned = { cwd: panel.cwd, shell: panel.shell }
    session.ptySize = { cols: term.cols || 80, rows: term.rows || 24 }
    try {
      await this.deps.api.spawnPty({
        id: panel.id,
        cwd: panel.cwd,
        shell: panel.shell,
        launch,
        cols: session.ptySize.cols,
        rows: session.ptySize.rows
      })
    } finally {
      if (launch) this.pendingLaunch.delete(panel.id)
    }
  }

  private save(session: Session): Promise<void> {
    // Cleared before serializing: output arriving during the save marks the
    // session again. A failed save marks it too, so the next pass retries;
    // the dirty state is never lost on failure.
    session.dirty = false
    const done = (async () => {
      let saved = false
      try {
        saved = await this.deps.api.saveScrollback(session.id, session.term.serialize())
      } catch {
        saved = false
      }
      if (!saved && this.sessions.get(session.id) === session) session.dirty = true
    })()
    this.saving.add(done)
    void done.finally(() => this.saving.delete(done))
    return done
  }

  private hide(session: Session): void {
    if (!session.visible) return
    session.visible = false
    this.deps.budget.release(session.id)
  }

  private refit(session: Session): void {
    if (!session.term.fit() || !session.started) return
    const { cols, rows } = session.term
    if (cols === session.ptySize.cols && rows === session.ptySize.rows) return
    session.ptySize = { cols, rows }
    this.deps.api.resizePty(session.id, cols, rows)
  }

  // One listener routes PTY output to every session, visible or not, so
  // hidden panels keep their buffers current.
  private ensureDataRouter(): void {
    if (this.unsubscribeData) return
    this.unsubscribeData = this.deps.api.onPtyData((id, data) => {
      const session = this.sessions.get(id)
      if (!session) return
      session.term.write(data)
      session.dirty = true
    })
  }
}
