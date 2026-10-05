import type { AgentDetectionResult, KnownAgentId } from './agents'

// 'none' is a plain shell, 'custom' runs the panel's own agentCommand, and
// anything else is an agent from src/shared/agents.ts. A state file written by
// a newer version may hold ids this version does not know; those run their
// agentCommand like a custom panel.
export type AgentKind = KnownAgentId | 'custom' | 'none'

export type PanelStatus =
  | 'idle' // shell open, no agent running
  | 'running' // agent actively working
  | 'waiting' // agent needs user input / permission
  | 'done' // agent finished its task
  | 'exited' // process ended
  | 'error' // process crashed or failed to start

export interface AgentConfigSetting {
  command: string
  args?: string
}

// Per-agent overrides of the command and default arguments. claude and codex
// are always present (schema v2); other agents fall back to the registry
// defaults when they have no entry.
export interface AgentSettings {
  claude: AgentConfigSetting
  codex: AgentConfigSetting
  [agentId: string]: AgentConfigSetting | undefined
}

export interface PanelConfig {
  id: string
  title: string
  cwd: string // project folder
  agent: AgentKind
  agentCommand?: string // e.g. "claude", "gemini" or a path
  agentArgs?: string // extra arguments e.g. "--verbose"
  shell: string // default: user's login shell
  env?: Record<string, string>
  // Runtime-only state (status, unread) is deliberately NOT part of PanelConfig:
  // it lives in memory and is never persisted.
}

// Stack shows the panels in one column; grid uses the preset's columns.
export type LayoutMode = 'stack' | 'grid'

export interface WorkspaceLayout {
  mode: LayoutMode
  // The last grid preset. Kept while in stack mode, so Grid restores it.
  rows: number
  cols: number
}

// A workspace is a "project" in the UI.
export interface WorkspaceConfig {
  id: string
  name: string
  // The project folder (schema v3). New panels start here. Workspaces from
  // before v3 have none.
  rootPath?: string
  layout: WorkspaceLayout
  panels: PanelConfig[]
  panelOrder: string[]
}

// Window chrome that survives a restart (schema v3).
export interface UiState {
  sidebarVisible: boolean
  sidebarWidth: number
  collapsedWorkspaceIds: string[]
  rightSlotWidth: number
}

export interface AppState {
  workspaces: WorkspaceConfig[]
  activeWorkspaceId: string
  lastUsedFolder?: string
  agentSettings: AgentSettings
  window: { x?: number; y?: number; width: number; height: number }
  ui?: UiState
  schemaVersion: number
}

export interface LaunchSpec {
  command: string // agent binary name or path (aliases are not supported)
  args?: string // extra args, split on whitespace by the launch shell
  // A first prompt, passed as one argument (never split or interpreted).
  prompt?: string
  // The flag before the prompt (e.g. '-i'); empty puts it after `--`.
  promptFlag?: string
}

export interface SpawnPtyOptions {
  id: string
  cwd: string
  shell?: string
  // If provided, the launch shell runs the agent and then execs an interactive shell.
  launch?: LaunchSpec
  env?: Record<string, string>
  cols: number
  rows: number
}

export interface ElectronAPI {
  // PTY operations
  spawnPty: (options: SpawnPtyOptions) => Promise<boolean>
  writePty: (id: string, data: string) => void
  resizePty: (id: string, cols: number, rows: number) => void
  killPty: (id: string) => void

  // Dialogs
  openDirectory: (defaultPath?: string) => Promise<string | null>
  // Whether each path is an existing directory (same order as `paths`).
  pathsExist: (paths: string[]) => Promise<boolean[]>

  // Persistence
  loadState: () => Promise<AppState>
  saveState: (state: AppState) => Promise<boolean>
  saveScrollback: (panelId: string, content: string) => Promise<boolean>
  loadScrollback: (panelId: string) => Promise<string | null>
  // Removes a closed panel's saved output.
  deleteScrollback: (panelId: string) => Promise<boolean>

  // Which agent CLIs the login shell can run. Cached in main; `refresh`
  // runs the check again.
  detectAgents: (refresh?: boolean) => Promise<AgentDetectionResult>
  // Whether a program runs in the panel: a launched agent, or a foreground
  // command in its shell.
  isPtyBusy: (id: string) => Promise<boolean>

  // System
  getDefaultShell: () => Promise<string>
  updateBadge: (count: number) => void
  sendNotification: (title: string, body: string, panelId?: string) => void
  notifyPanelFocus: (id: string) => void
  // Opens an http(s) link in the default browser; main ignores anything else.
  openExternal: (url: string) => void
  // The file system path of a file dropped on the page ('' when it has none).
  pathForFile: (file: File) => string

  // Events subscriptions
  onPtyData: (callback: (id: string, data: string) => void) => () => void
  onPtyExit: (callback: (id: string, exitCode: number) => void) => () => void
  onAgentStatus: (callback: (id: string, status: PanelStatus, detail?: string) => void) => () => void
  onFocusPanel: (callback: (id: string) => void) => () => void
  // Main asks the renderer to save every terminal's scrollback before the
  // window closes; it waits for the returned promise (with a timeout).
  onFlushScrollback: (callback: () => Promise<void>) => () => void

  // True only in a dev or test build started with MYTERM_DEBUG=1 (enables a
  // read-only test hook). Always false in a production build.
  isDebug: boolean
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
