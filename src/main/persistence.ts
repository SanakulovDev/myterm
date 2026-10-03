import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { AgentSettings, AppState, PanelConfig, WorkspaceConfig } from '../shared/types'
import { resolveDefaultShell } from './launch-script'

// v1: panels carried runtime fields (status, unread, autoLaunch).
// v2: panels hold configuration only; agentSettings always complete.
export const CURRENT_SCHEMA_VERSION = 2

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
    layout: { rows: 1, cols: 2 },
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

export class PersistenceService {
  private stateFilePath: string
  private v1BackupPath: string
  private scrollbackDir: string

  constructor() {
    const userData = app.getPath('userData')
    this.stateFilePath = path.join(userData, 'workspace-state.json')
    this.v1BackupPath = path.join(userData, 'workspace-state.v1-backup.json')
    this.scrollbackDir = path.join(userData, 'scrollbacks')
    if (!fs.existsSync(this.scrollbackDir)) {
      try {
        fs.mkdirSync(this.scrollbackDir, { recursive: true })
      } catch (err) {
        console.error('Failed to create scrollback dir:', err)
      }
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
        this.backupBeforeMigration()
        this.saveState(migrated)
      }

      return migrated
    } catch (err) {
      console.error('Failed to load state or file corrupted, backing up:', err)
      try {
        const backupPath = `${this.stateFilePath}.corrupt-${Date.now()}`
        fs.renameSync(this.stateFilePath, backupPath)
      } catch (backupErr) {
        console.error('Failed to backup corrupt state file:', backupErr)
      }
      return getDefaultState()
    }
  }

  /** One-time copy of the pre-v2 file, written before the first v2 save. */
  private backupBeforeMigration(): void {
    try {
      if (!fs.existsSync(this.v1BackupPath)) {
        fs.copyFileSync(this.stateFilePath, this.v1BackupPath)
      }
    } catch (err) {
      console.error('Failed to back up state before migration:', err)
    }
  }

  public saveState(state: AppState): boolean {
    try {
      const tempPath = `${this.stateFilePath}.tmp-${Date.now()}`
      const json = JSON.stringify(sanitizeForSave(state), null, 2)
      fs.writeFileSync(tempPath, json, 'utf8')
      fs.renameSync(tempPath, this.stateFilePath)
      return true
    } catch (err) {
      console.error('Failed to atomically save state:', err)
      return false
    }
  }

  public saveScrollback(panelId: string, content: string): boolean {
    try {
      const target = path.join(this.scrollbackDir, `${panelId}.log`)
      fs.writeFileSync(target, content, 'utf8')
      return true
    } catch (err) {
      console.error(`Failed to save scrollback for ${panelId}:`, err)
      return false
    }
  }

  public loadScrollback(panelId: string): string | null {
    try {
      const target = path.join(this.scrollbackDir, `${panelId}.log`)
      if (fs.existsSync(target)) {
        return fs.readFileSync(target, 'utf8')
      }
    } catch (err) {
      console.error(`Failed to load scrollback for ${panelId}:`, err)
    }
    return null
  }
}
