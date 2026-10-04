import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { ElectronAPI, SpawnPtyOptions, AppState, PanelStatus } from '../shared/types'

const api: ElectronAPI = {
  spawnPty: (options: SpawnPtyOptions) => ipcRenderer.invoke('pty:spawn', options),
  writePty: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
  resizePty: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  killPty: (id: string) => ipcRenderer.send('pty:kill', id),

  openDirectory: (defaultPath?: string) => ipcRenderer.invoke('dialog:open-directory', defaultPath),

  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state: AppState) => ipcRenderer.invoke('state:save', state),
  saveScrollback: (panelId: string, content: string) =>
    ipcRenderer.invoke('state:save-scrollback', panelId, content),
  loadScrollback: (panelId: string) => ipcRenderer.invoke('state:load-scrollback', panelId),
  deleteScrollback: (panelId: string) => ipcRenderer.invoke('state:delete-scrollback', panelId),

  getDefaultShell: () => ipcRenderer.invoke('shell:get-default'),
  detectAgents: (refresh?: boolean) => ipcRenderer.invoke('agents:detect', refresh === true),
  isPtyBusy: (id: string) => ipcRenderer.invoke('pty:is-busy', id),
  updateBadge: (count: number) => ipcRenderer.send('app:update-badge', count),
  sendNotification: (title: string, body: string, panelId?: string) =>
    ipcRenderer.send('app:notify', title, body, panelId),
  notifyPanelFocus: (id: string) => ipcRenderer.send('panel:focus', id),
  openExternal: (url: string) => ipcRenderer.send('app:open-external', url),
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  onPtyData: (callback: (id: string, data: string) => void) => {
    const handler = (_event: unknown, id: string, data: string): void => callback(id, data)
    ipcRenderer.on('pty:data', handler)
    return (): void => {
      ipcRenderer.removeListener('pty:data', handler)
    }
  },

  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    const handler = (_event: unknown, id: string, exitCode: number): void => callback(id, exitCode)
    ipcRenderer.on('pty:exit', handler)
    return (): void => {
      ipcRenderer.removeListener('pty:exit', handler)
    }
  },

  onAgentStatus: (callback: (id: string, status: PanelStatus, detail?: string) => void) => {
    const handler = (_event: unknown, id: string, status: PanelStatus, detail?: string): void =>
      callback(id, status, detail)
    ipcRenderer.on('agent:status', handler)
    return (): void => {
      ipcRenderer.removeListener('agent:status', handler)
    }
  },

  onFocusPanel: (callback: (id: string) => void) => {
    const handler = (_event: unknown, id: string): void => callback(id)
    ipcRenderer.on('notification:focus-panel', handler)
    return (): void => {
      ipcRenderer.removeListener('notification:focus-panel', handler)
    }
  },

  onFlushScrollback: (callback: () => Promise<void>) => {
    const handler = async (): Promise<void> => {
      try {
        await callback()
      } finally {
        ipcRenderer.send('app:flush-scrollback-done')
      }
    }
    ipcRenderer.on('app:flush-scrollback', handler)
    return (): void => {
      ipcRenderer.removeListener('app:flush-scrollback', handler)
    }
  },

  // Compiled out of production builds (see src/shared/build-flags.d.ts).
  isDebug: __MYTERM_TEST_HOOKS__ ? process.env.MYTERM_DEBUG === '1' : false
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error('Failed to expose electronAPI via contextBridge:', error)
  }
} else {
  // Fallback if contextIsolation is disabled
  window.electronAPI = api
}
