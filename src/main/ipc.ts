import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { PtyManager } from './pty-manager'
import { AgentTracker } from './agent-tracker'
import { NotificationService } from './notifications'
import { PersistenceService } from './persistence'
import { resolveDefaultShell } from './launch-script'
import { launchEventStatus } from './launch-marker'
import { isSafeExternalUrl } from './external-links'
import { AppState, SpawnPtyOptions } from '../shared/types'

// Handlers and tracker listeners live as long as the app, not the window: a
// second registration would throw (ipcMain.handle) or deliver every event
// twice (tracker listeners), so it is refused.
let registered = false

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  ptyManager: PtyManager,
  agentTracker: AgentTracker,
  notificationService: NotificationService,
  persistenceService: PersistenceService
): boolean {
  if (registered) {
    console.error('IPC handlers are already registered; ignoring the second registration')
    return false
  }
  registered = true

  // The window is looked up at send time, never captured: PTYs outlive any
  // particular window state (hidden, shown, recreated).
  const send = (channel: string, ...args: unknown[]): void => {
    const win = getMainWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }

  // PTY spawn. With `launch`, the agent runs inside the launch shell and the
  // panel status follows the launch events: running -> idle (marker). Done and
  // waiting only come from hooks.
  ipcMain.handle('pty:spawn', async (_event, options: SpawnPtyOptions) => {
    const success = ptyManager.spawn(
      options,
      (data) => {
        send('pty:data', options.id, data)
        // The output-quiet heuristic (agentTracker.onPtyOutput) is disabled: it
        // would mark a long-thinking agent as done. Hooks provide done/waiting.
      },
      (exitCode) => {
        send('pty:exit', options.id, exitCode)
        agentTracker.setStatus(
          options.id,
          exitCode === 0 ? 'exited' : 'error',
          exitCode === 0 ? 'Process exited normally' : `Process exited with code ${exitCode}`
        )
      },
      (launchEvent) => {
        const { status, detail } = launchEventStatus(launchEvent)
        agentTracker.setStatus(options.id, status, detail)
      }
    )

    if (!success) {
      agentTracker.setStatus(options.id, 'error', 'Spawn failure')
    } else if (!options.launch) {
      agentTracker.setStatus(options.id, 'idle')
    }

    return success
  })

  // PTY write
  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    agentTracker.onUserInput(id)
    ptyManager.write(id, data)
  })

  // PTY resize
  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows)
  })

  // PTY kill
  ipcMain.on('pty:kill', (_event, id: string) => {
    ptyManager.kill(id)
    agentTracker.removePanel(id)
  })

  // Native directory picker dialog
  ipcMain.handle('dialog:open-directory', async (_event, defaultPath?: string) => {
    const win = getMainWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: 'Select Project Directory',
      defaultPath: defaultPath || process.env.HOME,
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // Persistence
  ipcMain.handle('state:load', async () => {
    return persistenceService.loadState()
  })

  ipcMain.handle('state:save', async (_event, state: AppState) => {
    return persistenceService.saveState(state)
  })

  ipcMain.handle('state:save-scrollback', async (_event, panelId: string, content: string) => {
    return persistenceService.saveScrollback(panelId, content)
  })

  ipcMain.handle('state:load-scrollback', async (_event, panelId: string) => {
    return persistenceService.loadScrollback(panelId)
  })

  ipcMain.handle('state:delete-scrollback', async (_event, panelId: string) => {
    return persistenceService.deleteScrollback(panelId)
  })

  // System & Shell
  ipcMain.handle('shell:get-default', async () => {
    return resolveDefaultShell()
  })

  ipcMain.on('app:update-badge', (_event, count: number) => {
    notificationService.setBadge(count)
  })

  ipcMain.on('app:notify', (_event, title: string, body: string, panelId?: string) => {
    notificationService.notify(title, body, panelId)
  })

  // A Cmd+clicked link in a terminal.
  ipcMain.on('app:open-external', (_event, url: unknown) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  ipcMain.on('panel:focus', (_event, panelId: string) => {
    agentTracker.setActivePanel(panelId)
    notificationService.setFocusedPanel(panelId)
  })

  // Listen to tracker status changes and forward to renderer
  agentTracker.on('status-change', (event) => {
    send('agent:status', event.panelId, event.status, event.detail)

    // Spec 5.3: Trigger notification on waiting or done
    if (event.status === 'waiting') {
      notificationService.notify(
        'Agent needs attention',
        event.detail || 'Agent is waiting for your input or permission',
        event.panelId
      )
    } else if (event.status === 'done') {
      notificationService.notify(
        'Agent completed task',
        event.detail || 'Agent finished running',
        event.panelId
      )
    }
  })

  agentTracker.on('unread-change', (count: number) => {
    notificationService.setBadge(count)
  })

  notificationService.onPanelClick((panelId) => {
    send('notification:focus-panel', panelId)
  })

  return true
}
