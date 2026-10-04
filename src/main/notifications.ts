import { Notification, app, BrowserWindow } from 'electron'

export class NotificationService {
  private lastNotificationTimes: Map<string, number> = new Map()
  private onPanelClickCallback?: (panelId: string) => void
  private focusedPanelId?: string
  private getMainWindow: () => BrowserWindow | null

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow
  }

  public setFocusedPanel(panelId: string): void {
    this.focusedPanelId = panelId
  }

  public onPanelClick(callback: (panelId: string) => void): void {
    this.onPanelClickCallback = callback
  }

  public notify(title: string, body: string, panelId?: string): void {
    const win = this.getMainWindow()
    const isAppFocused = win?.isFocused() ?? false

    // Spec 5.3: "Notify only when the app window is not focused, or when the panel is not the focused panel."
    if (isAppFocused && panelId && panelId === this.focusedPanelId) {
      return
    }

    // Coalesce / debounce rapid notifications for the same panel (3 sec)
    const now = Date.now()
    if (panelId) {
      const last = this.lastNotificationTimes.get(panelId) || 0
      if (now - last < 3000) {
        return
      }
      this.lastNotificationTimes.set(panelId, now)
    }

    if (!Notification.isSupported()) {
      return
    }

    const notification = new Notification({
      title,
      body,
      silent: false
    })

    notification.on('click', () => {
      const mainWindow = this.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        // The close button only hides the window.
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
      }
      if (panelId && this.onPanelClickCallback) {
        this.onPanelClickCallback(panelId)
      }
    })

    notification.show()
  }

  public setBadge(count: number): void {
    if (process.platform === 'darwin') {
      const badgeText = count > 0 ? `${count}` : ''
      app.dock.setBadge(badgeText)
    }
  }
}
