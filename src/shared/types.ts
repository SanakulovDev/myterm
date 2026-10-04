export type AgentKind = 'claude' | 'codex' | 'none'

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

export interface AgentSettings {
  claude: AgentConfigSetting
  codex: AgentConfigSetting
}

export interface PanelConfig {
  id: string
  title: string
  cwd: string // project folder
  agent: AgentKind
  agentCommand?: string // e.g. "claude" or "codex"
  agentArgs?: string // extra arguments e.g. "--verbose"
  shell: string // default: user's login shell
  env?: Record<string, string>
  // Runtime-only state (status, unread) is deliberately NOT part of PanelConfig:
  // it lives in memory and is never persisted.
}

export interface WorkspaceConfig {
  id: string
  name: string
  layout: { rows: number; cols: number }
  panels: PanelConfig[]
  panelOrder: string[]
}

export interface AppState {
  workspaces: WorkspaceConfig[]
  activeWorkspaceId: string
  lastUsedFolder?: string
  agentSettings: AgentSettings
  window: { x?: number; y?: number; width: number; height: number }
  schemaVersion: number
}

export interface LaunchSpec {
  command: string // agent binary name or path (aliases are not supported)
  args?: string // extra args, split on whitespace by the launch shell
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

  // Persistence
  loadState: () => Promise<AppState>
  saveState: (state: AppState) => Promise<boolean>
  saveScrollback: (panelId: string, content: string) => Promise<boolean>
  loadScrollback: (panelId: string) => Promise<string | null>
  // Removes a closed panel's saved output.
  deleteScrollback: (panelId: string) => Promise<boolean>

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
