import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron'
import * as path from 'path'
import { BusyPanel, PtyManager } from './pty-manager'
import { AgentTracker } from './agent-tracker'
import { HookServer } from './hook-server'
import { NotificationService } from './notifications'
import { PersistenceService } from './persistence'
import { registerIpcHandlers } from './ipc'
import { isSafeExternalUrl } from './external-links'

// Packaged builds refuse the Chromium debugging switches the end-to-end tests
// use, before anything touches the user's data. (The Node inspector switches
// are disabled by a fuse at package time, see scripts/after-pack.cjs.)
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe']
if (app.isPackaged && DEBUG_SWITCHES.some((s) => app.commandLine.hasSwitch(s))) {
  console.error('Debugging switches are not available in a packaged build')
  process.exit(1)
}

let mainWindow: BrowserWindow | null = null
// Set once a quit needs no more confirmation; windows then close for real.
let isQuitting = false
// The open "processes are running" prompt. Aborting it counts as Cancel.
let quitPrompt: AbortController | null = null

// How long a closing window waits for the renderer to save scrollback.
const SCROLLBACK_FLUSH_TIMEOUT_MS = 1500

const persistenceService = new PersistenceService()
const agentTracker = new AgentTracker()
const hookServer = new HookServer()
const ptyManager = new PtyManager()
const notificationService = new NotificationService(() => mainWindow)

// Everything that must exist exactly once per app run, whatever happens to
// the window: the hook server, the IPC handlers and the shutdown hooks.
async function bootstrap(): Promise<void> {
  await hookServer.start()
  ptyManager.setSocketPath(hookServer.getSocketPath())
  ptyManager.setAppVersion(app.getVersion())
  hookServer.onEvent((panelId, status, detail) => {
    agentTracker.setStatus(panelId, status, detail, false)
  })

  registerIpcHandlers(
    () => mainWindow,
    ptyManager,
    agentTracker,
    notificationService,
    persistenceService
  )
  watchForSystemShutdown()
  createWindow()

  // End-to-end tests drive the main process through the Node inspector.
  // Compiled out of release builds (see scripts/check-release.mjs).
  if (__MYTERM_TEST_HOOKS__) {
    Object.assign(globalThis, {
      __mytermMain: {
        app,
        BrowserWindow,
        dialog,
        ipcMain,
        powerMonitor,
        shell,
        ptyManager,
        agentTracker,
        window: () => mainWindow,
        isQuitting: () => isQuitting
      }
    })
  }
}

function createWindow(): void {
  const savedState = persistenceService.loadState()
  const windowBounds = savedState.window || { width: 1280, height: 850 }

  const win = new BrowserWindow({
    width: windowBounds.width || 1280,
    height: windowBounds.height || 850,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: 800,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // The window is hidden, not closed, by the close button. PTY output,
      // the scrollback autosave and every timer must keep full speed then.
      backgroundThrottling: false
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // Debounced window bounds persistence
  let resizeTimeout: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      if (!win.isDestroyed()) {
        const currentState = persistenceService.loadState()
        currentState.window = win.getBounds()
        persistenceService.saveState(currentState)
      }
    }, 500)
  }

  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // The close button hides the window: the app, the renderer and every PTY
  // keep running, and the Dock icon shows the same window again. Only a quit
  // closes it, after the renderer saved every changed terminal. That wait is
  // bounded: a hung renderer only costs the timeout.
  let scrollbackFlush: 'pending' | 'running' | 'done' = 'pending'
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      if (process.platform === 'darwin') hideWindow(win)
      else app.quit()
      return
    }
    if (scrollbackFlush === 'done' || win.webContents.isDestroyed()) return
    event.preventDefault()
    if (scrollbackFlush === 'running') return
    scrollbackFlush = 'running'
    requestScrollbackFlush(win).then(() => {
      scrollbackFlush = 'done'
      // Preventing the close cancelled the quit in progress; resume it.
      app.quit()
    })
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The app is a single page. A file dropped outside a terminal, or a link,
  // must never replace it.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // Load renderer
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    win.loadURL(rendererUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function hideWindow(win: BrowserWindow): void {
  // A full-screen window leaves full screen first, or its Space would stay
  // behind as an empty black screen.
  if (win.isFullScreen()) {
    win.once('leave-full-screen', () => win.hide())
    win.setFullScreen(false)
  } else {
    win.hide()
  }
  // Save changed terminals now rather than at the next autosave. Not
  // awaited: hiding never waits on the renderer.
  if (!win.webContents.isDestroyed()) win.webContents.send('app:flush-scrollback')
}

function requestScrollbackFlush(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('app:flush-scrollback-done', onDone)
      resolve()
    }
    const onDone = (event: Electron.IpcMainEvent): void => {
      if (event.sender === win.webContents) finish()
    }
    const timer = setTimeout(finish, SCROLLBACK_FLUSH_TIMEOUT_MS)
    ipcMain.on('app:flush-scrollback-done', onDone)
    win.webContents.send('app:flush-scrollback')
  })
}

// System shutdown, restart and logout must never wait on the quit prompt.
function watchForSystemShutdown(): void {
  // Logout, restart and shut down (NSWorkspaceWillPowerOffNotification on
  // macOS, logind on Linux).
  powerMonitor.on('shutdown', quitWithoutPrompt)
  // launchd sends SIGTERM to apps still running late in a shutdown; `kill`
  // and a closing terminal (dev runs) send SIGTERM, SIGHUP or SIGINT.
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
    process.on(signal, quitWithoutPrompt)
  }
}

function quitWithoutPrompt(): void {
  isQuitting = true
  quitPrompt?.abort()
  app.quit()
}

/** Panel titles from the saved state, for the quit prompt. */
function panelTitles(): Map<string, string> {
  const titles = new Map<string, string>()
  for (const ws of persistenceService.loadState().workspaces) {
    for (const panel of ws.panels) titles.set(panel.id, panel.title)
  }
  return titles
}

async function confirmQuit(busy: BusyPanel[]): Promise<void> {
  const controller = new AbortController()
  quitPrompt = controller

  // Shown as a sheet on the window: on macOS only a dialog with a parent
  // window can be aborted, which a system shutdown needs.
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  if (win && !win.isVisible()) win.show()

  const titles = panelTitles()
  const lines = busy.map((b) => `• ${titles.get(b.id) ?? b.id}: ${path.basename(b.process)}`)
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message:
      busy.length === 1
        ? 'A panel is still running a process. Quit anyway?'
        : `${busy.length} panels are still running processes. Quit anyway?`,
    detail: `${lines.join('\n')}\n\nQuitting stops them. Terminal output is saved.`,
    signal: controller.signal
  }

  let confirmed = false
  try {
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    confirmed = response === 0 && !controller.signal.aborted
  } finally {
    quitPrompt = null
  }
  if (confirmed) {
    isQuitting = true
    app.quit()
  }
}

app.whenReady().then(async () => {
  await bootstrap()

  // Dock icon click (or a second launch): show the one existing window. No
  // new renderer, no respawned PTYs.
  app.on('activate', () => {
    if (isQuitting) return
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    else createWindow()
  })
})

// Cmd+Q, Dock > Quit, and app.quit() all start here. A user quit with a
// busy panel asks first; shutdown and signals set isQuitting beforehand.
app.on('before-quit', (event) => {
  if (isQuitting) return
  const busy = ptyManager.busyPanels()
  if (busy.length === 0) {
    isQuitting = true
    return
  }
  event.preventDefault()
  if (!quitPrompt) void confirmQuit(busy)
})

// On macOS the window only closes while quitting (it is hidden otherwise), so
// this matters on other platforms only.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// PTYs outlive the window close handler so nothing dies before scrollback is
// saved; will-quit runs once every window has closed.
app.on('will-quit', () => {
  ptyManager.killAll()
  hookServer.stop()
})
