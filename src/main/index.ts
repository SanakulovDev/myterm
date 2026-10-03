import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import { PtyManager } from './pty-manager'
import { AgentTracker } from './agent-tracker'
import { HookServer } from './hook-server'
import { NotificationService } from './notifications'
import { PersistenceService } from './persistence'
import { registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// How long a closing window waits for the renderer to save scrollback.
const SCROLLBACK_FLUSH_TIMEOUT_MS = 1500

const persistenceService = new PersistenceService()
const agentTracker = new AgentTracker()
const hookServer = new HookServer()
const ptyManager = new PtyManager()
const notificationService = new NotificationService(() => mainWindow)

async function createWindow(): Promise<void> {
  const savedState = persistenceService.loadState()
  const windowBounds = savedState.window || { width: 1280, height: 850 }

  mainWindow = new BrowserWindow({
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
      nodeIntegration: false
    }
  })

  // Start hook server and pass socket to PTY manager
  await hookServer.start()
  ptyManager.setSocketPath(hookServer.getSocketPath())

  hookServer.onEvent((panelId, status, detail) => {
    agentTracker.setStatus(panelId, status, detail, false)
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })

  // Debounced window bounds persistence
  let resizeTimeout: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (resizeTimeout) clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const bounds = mainWindow.getBounds()
        const currentState = persistenceService.loadState()
        currentState.window = bounds
        persistenceService.saveState(currentState)
      }
    }, 500)
  }

  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // Terminals keep their scrollback in the renderer, so ask it to save every
  // panel before the window goes away. Closing is delayed, never blocked: a
  // hung renderer only costs the timeout.
  let scrollbackFlush: 'pending' | 'running' | 'done' = 'pending'
  mainWindow.on('close', (event) => {
    const win = mainWindow
    if (!win || scrollbackFlush === 'done' || win.webContents.isDestroyed()) return
    event.preventDefault()
    if (scrollbackFlush === 'running') return
    scrollbackFlush = 'running'
    requestScrollbackFlush(win).then(() => {
      scrollbackFlush = 'done'
      // Preventing the close cancelled any quit in progress; resume it.
      if (isQuitting) app.quit()
      else if (!win.isDestroyed()) win.close()
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register all IPC handlers
  registerIpcHandlers(
    () => mainWindow,
    ptyManager,
    agentTracker,
    notificationService,
    persistenceService
  )

  // Load renderer
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  hookServer.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
})

// PTYs outlive the window close handler so nothing dies before scrollback is
// saved; will-quit runs once every window has closed.
app.on('will-quit', () => {
  ptyManager.killAll()
  hookServer.stop()
})
