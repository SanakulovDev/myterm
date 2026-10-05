import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { AgentSettings, AppState, PanelConfig, UiState, WorkspaceConfig } from '../shared/types'
import { DEFAULT_UI_STATE, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../shared/layout'
import { resolveDefaultShell } from './launch-script'

// v1: panels carried runtime fields (status, unread, autoLaunch).
// v2: panels hold configuration only; agentSettings always complete.
//
// More agents (gemini, opencode, ...) did not need v3: a panel's `agent` is
// still a string with its command in `agentCommand`, and agentSettings only
// gains optional entries next to claude and codex. Earlier v2 builds keep
// unknown keys and launch such a panel by its agentCommand.
// v3: layout.mode ('stack' | 'grid', existing workspaces become stack with
// their rows/cols kept for grid), optional workspace rootPath, and `ui`
// (sidebar, collapsed projects). Every v3 field is optional on disk.
export const CURRENT_SCHEMA_VERSION = 3

// Runtime-only (or launch-intent) fields that must never be persisted.
const RUNTIME_PANEL_FIELDS = ['status', 'unread', 'autoLaunch']

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  claude: { command: 'claude', args: '' },
  codex: { command: 'codex', args: '' }
}

const DEFAULT_WINDOW = { width: 1280, height: 850 }

export function getDefaultState(): AppState {
  const defaultWorkspaceId = 'ws-default'
  const shell = resolveDefaultShell()
  const defaultWorkspace: WorkspaceConfig = {
    id: defaultWorkspaceId,
    name: 'Main Workspace',
    layout: { mode: 'stack', rows: 1, cols: 2 },
    panels: [
      {
        id: 'panel-1',
        title: 'Terminal 1',
        cwd: process.env.HOME || '/',
        agent: 'none',
        shell
      },
      {
        id: 'panel-2',
        title: 'Terminal 2',
        cwd: process.env.HOME || '/',
        agent: 'none',
        shell
      }
    ],
    panelOrder: ['panel-1', 'panel-2']
  }

  return {
    workspaces: [defaultWorkspace],
    activeWorkspaceId: defaultWorkspaceId,
    lastUsedFolder: process.env.HOME || '/',
    agentSettings: structuredClone(DEFAULT_AGENT_SETTINGS),
    window: { ...DEFAULT_WINDOW },
    ui: structuredClone(DEFAULT_UI_STATE),
    schemaVersion: CURRENT_SCHEMA_VERSION
  }
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripRuntimeFields(panel: Json): Json {
  const clean = { ...panel }
  for (const field of RUNTIME_PANEL_FIELDS) delete clean[field]
  return clean
}

function migratePanel(panel: Json, defaultShell: string): Json {
  const clean = stripRuntimeFields(panel)
  if (typeof clean.shell !== 'string' || !clean.shell.trim()) clean.shell = defaultShell
  return clean
}

function mergeAgentSettings(raw: unknown): AgentSettings {
  const settings = isObject(raw) ? raw : {}
  const merged: Json = { ...settings }
  for (const kind of ['claude', 'codex'] as const) {
    const current = isObject(settings[kind]) ? settings[kind] : {}
    const entry: Json = { ...DEFAULT_AGENT_SETTINGS[kind], ...current }
    if (typeof entry.command !== 'string' || !entry.command.trim()) {
      entry.command = DEFAULT_AGENT_SETTINGS[kind].command
    }
    if (typeof entry.args !== 'string') entry.args = ''
    merged[kind] = entry
  }
  return merged as unknown as AgentSettings
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

// Before v3 every workspace was a grid; it becomes a stack and keeps its
// rows/cols for the Grid choice.
function migrateLayout(raw: unknown, version: number): Json {
  const layout = isObject(raw) ? raw : {}
  const mode = version >= 3 && (layout.mode === 'stack' || layout.mode === 'grid') ? layout.mode : 'stack'
  return { ...layout, mode, rows: positiveInt(layout.rows, 1), cols: positiveInt(layout.cols, 2) }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function migrateUi(raw: unknown): UiState {
  const ui = isObject(raw) ? raw : {}
  return {
    ...ui,
    sidebarVisible: typeof ui.sidebarVisible === 'boolean' ? ui.sidebarVisible : DEFAULT_UI_STATE.sidebarVisible,
    sidebarWidth: clamp(ui.sidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, DEFAULT_UI_STATE.sidebarWidth),
    collapsedWorkspaceIds: Array.isArray(ui.collapsedWorkspaceIds)
      ? ui.collapsedWorkspaceIds.filter((id): id is string => typeof id === 'string')
      : [],
    rightSlotWidth: clamp(ui.rightSlotWidth, 320, 400, DEFAULT_UI_STATE.rightSlotWidth)
  }
}

/**
 * Bring any previously saved state up to the current schema. Pure and
 * idempotent. Unknown fields are kept. Returns null when the input has no
 * usable workspaces (the caller falls back to defaults).
 */
export function migrateState(raw: unknown, defaultShell: string): AppState | null {
  if (!isObject(raw)) return null
  if (!Array.isArray(raw.workspaces) || raw.workspaces.length === 0) return null

  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1
  if (version > CURRENT_SCHEMA_VERSION) {
    console.warn(
      `State schemaVersion ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}; loading best-effort`
    )
  }

  const workspaces = raw.workspaces.filter(isObject).map((ws) => ({
    ...ws,
    layout: migrateLayout(ws.layout, version),
    panels: Array.isArray(ws.panels)
      ? ws.panels.filter(isObject).map((p) => migratePanel(p, defaultShell))
      : [],
    panelOrder: Array.isArray(ws.panelOrder) ? ws.panelOrder : []
  })) as unknown as WorkspaceConfig[]
  if (workspaces.length === 0) return null

  return {
    ...raw,
    workspaces,
    activeWorkspaceId:
      typeof raw.activeWorkspaceId === 'string' ? raw.activeWorkspaceId : workspaces[0].id,
    agentSettings: mergeAgentSettings(raw.agentSettings),
    window: isObject(raw.window) ? (raw.window as AppState['window']) : { ...DEFAULT_WINDOW },
    ui: migrateUi(raw.ui),
    schemaVersion: Math.max(version, CURRENT_SCHEMA_VERSION)
  } as AppState
}

/** Defensive copy for writing: runtime fields never reach disk. */
function sanitizeForSave(state: AppState): AppState {
  return {
    ...state,
    workspaces: state.workspaces.map((ws) => ({
      ...ws,
      panels: ws.panels.map((p) => stripRuntimeFields(p as unknown as Json) as unknown as PanelConfig)
    })),
    schemaVersion: Math.max(state.schemaVersion || 0, CURRENT_SCHEMA_VERSION)
  }
}

// Saved state and terminal output can contain secrets: owner-only on disk.
export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600

// Panel ids become file names, so anything else is refused.
const PANEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const SCROLLBACK_SUFFIX = '.log'
// Temporary files of an atomic write: <panel>.log.tmp-<pid>-<n>
const TEMP_MARKER = '.tmp-'

let tempCounter = 0

/** Writes `content` to a temp file next to `target`, then renames it over. */
async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temp = `${target}${TEMP_MARKER}${process.pid}-${++tempCounter}`
  try {
    const handle = await fs.promises.open(temp, 'w', PRIVATE_FILE_MODE)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.promises.rename(temp, target)
  } catch (err) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined)
    throw err
  }
}

function chmodQuiet(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode)
  } catch {
    // Missing files need no fixing; anything else is retried next start.
  }
}

export class PersistenceService {
  private stateFilePath: string
  private userData: string
  private scrollbackDir: string
  // Scrollback writes and deletes of one panel run in order, one at a time.
  private readonly scrollbackQueues = new Map<string, Promise<unknown>>()
  private orphansSwept = false

  constructor() {
    const userData = app.getPath('userData')
    this.userData = userData
    this.stateFilePath = path.join(userData, 'workspace-state.json')
    this.scrollbackDir = path.join(userData, 'scrollbacks')
    try {
      fs.mkdirSync(this.scrollbackDir, { recursive: true, mode: PRIVATE_DIR_MODE })
    } catch (err) {
      console.error('Failed to create scrollback dir:', err)
    }
    this.restrictPermissions(userData)
  }

  /** Files written by older versions were world-readable; tighten them. */
  private restrictPermissions(userData: string): void {
    chmodQuiet(this.scrollbackDir, PRIVATE_DIR_MODE)
    let names: string[] = []
    try {
      names = fs.readdirSync(this.scrollbackDir)
    } catch {
      // No directory, nothing to fix.
    }
    for (const name of names) chmodQuiet(path.join(this.scrollbackDir, name), PRIVATE_FILE_MODE)
    try {
      names = fs.readdirSync(userData)
    } catch {
      names = []
    }
    for (const name of names) {
      if (name.startsWith('workspace-state.')) chmodQuiet(path.join(userData, name), PRIVATE_FILE_MODE)
    }
  }

  public loadState(): AppState {
    if (!fs.existsSync(this.stateFilePath)) {
      const defaultState = getDefaultState()
      this.saveState(defaultState)
      return defaultState
    }

    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)

      const migrated = migrateState(parsed, resolveDefaultShell())
      if (!migrated) {
        return getDefaultState()
      }

      const rawVersion = isObject(parsed) ? parsed.schemaVersion : undefined
      if (typeof rawVersion !== 'number' || rawVersion < CURRENT_SCHEMA_VERSION) {
        console.log(`Migrating state from schemaVersion ${rawVersion ?? 1} to ${CURRENT_SCHEMA_VERSION}`)
        this.backupBeforeMigration(typeof rawVersion === 'number' ? rawVersion : 1)
        this.saveState(migrated)
      }

      this.sweepOrphanScrollbacks(migrated)
      return migrated
    } catch (err) {
      console.error('Failed to load state or file corrupted, backing up:', err)
      try {
        const backupPath = `${this.stateFilePath}.corrupt-${Date.now()}`
        fs.renameSync(this.stateFilePath, backupPath)
        chmodQuiet(backupPath, PRIVATE_FILE_MODE)
      } catch (backupErr) {
        console.error('Failed to backup corrupt state file:', backupErr)
      }
      return getDefaultState()
    }
  }

  /**
   * One-time copy of the file as an older version wrote it, made before the
   * first save in the current schema: workspace-state.v{N}-backup.json.
   */
  private backupBeforeMigration(fromVersion: number): void {
    const version = Number.isInteger(fromVersion) && fromVersion >= 1 ? fromVersion : 1
    const backupPath = path.join(this.userData, `workspace-state.v${version}-backup.json`)
    try {
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.stateFilePath, backupPath)
        chmodQuiet(backupPath, PRIVATE_FILE_MODE)
      }
    } catch (err) {
      console.error('Failed to back up state before migration:', err)
    }
  }

  /**
   * Deletes saved output of panels that no longer exist (closed while the
   * app could not delete the file) and temp files of interrupted writes.
   * Runs once, and only after the state file loaded cleanly: with a missing
   * or corrupt state file every saved output would look orphaned.
   */
  private sweepOrphanScrollbacks(state: AppState): void {
    if (this.orphansSwept) return
    this.orphansSwept = true
    const panelIds = new Set(state.workspaces.flatMap((ws) => ws.panels.map((p) => p.id)))
    let names: string[] = []
    try {
      names = fs.readdirSync(this.scrollbackDir)
    } catch {
      return
    }
    for (const name of names) {
      const isTemp = name.includes(`${SCROLLBACK_SUFFIX}${TEMP_MARKER}`)
      const isOrphan =
        name.endsWith(SCROLLBACK_SUFFIX) && !panelIds.has(name.slice(0, -SCROLLBACK_SUFFIX.length))
      if (!isTemp && !isOrphan) continue
      try {
        fs.rmSync(path.join(this.scrollbackDir, name), { force: true })
      } catch (err) {
        console.error(`Failed to remove stale scrollback ${name}:`, err)
      }
    }
  }

  public saveState(state: AppState): boolean {
    const tempPath = `${this.stateFilePath}${TEMP_MARKER}${process.pid}-${++tempCounter}`
    try {
      const json = JSON.stringify(sanitizeForSave(state), null, 2)
      fs.writeFileSync(tempPath, json, { encoding: 'utf8', mode: PRIVATE_FILE_MODE })
      fs.renameSync(tempPath, this.stateFilePath)
      return true
    } catch (err) {
      console.error('Failed to atomically save state:', err)
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // Best effort.
      }
      return false
    }
  }

  private scrollbackPath(panelId: string): string | null {
    if (typeof panelId !== 'string' || !PANEL_ID_PATTERN.test(panelId)) {
      console.error(`Refusing scrollback access for invalid panel id: ${String(panelId)}`)
      return null
    }
    return path.join(this.scrollbackDir, `${panelId}${SCROLLBACK_SUFFIX}`)
  }

  /** Runs `task` after every earlier scrollback task of the same panel. */
  private enqueue<T>(panelId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.scrollbackQueues.get(panelId) ?? Promise.resolve()
    const result = previous.then(task)
    const tail = result.catch(() => undefined)
    this.scrollbackQueues.set(panelId, tail)
    void tail.then(() => {
      if (this.scrollbackQueues.get(panelId) === tail) this.scrollbackQueues.delete(panelId)
    })
    return result
  }

  /** Atomic write (temp file + rename), owner-only. Resolves false on failure. */
  public saveScrollback(panelId: string, content: string): Promise<boolean> {
    const target = this.scrollbackPath(panelId)
    if (!target || typeof content !== 'string') return Promise.resolve(false)
    return this.enqueue(panelId, async () => {
      try {
        await writeFileAtomic(target, content)
        return true
      } catch (err) {
        console.error(`Failed to save scrollback for ${panelId}:`, err)
        return false
      }
    })
  }

  /** Removes a closed panel's saved output, after any write still queued. */
  public deleteScrollback(panelId: string): Promise<boolean> {
    const target = this.scrollbackPath(panelId)
    if (!target) return Promise.resolve(false)
    return this.enqueue(panelId, async () => {
      try {
        await fs.promises.rm(target, { force: true })
        return true
      } catch (err) {
        console.error(`Failed to delete scrollback for ${panelId}:`, err)
        return false
      }
    })
  }

  public loadScrollback(panelId: string): Promise<string | null> {
    const target = this.scrollbackPath(panelId)
    if (!target) return Promise.resolve(null)
    return this.enqueue(panelId, async () => {
      try {
        return await fs.promises.readFile(target, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Failed to load scrollback for ${panelId}:`, err)
        }
        return null
      }
    })
  }
}
