import { describe, it, expect, vi, beforeAll } from 'vitest'

// IPC handlers are registered once for the app's lifetime. A second
// registration (the old code did it on every window creation) must neither
// throw nor double the events, and events go to whichever window is current
// when they are sent.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    // Like Electron: a second handler for a channel throws.
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      handlers.set(channel, handler)
    },
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    }
  },
  dialog: {},
  app: { getPath: () => '/tmp' },
  Notification: { isSupported: () => false },
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: true,
    on: (_event: string, _callback: () => void) => {}
  }
}))

import { registerIpcHandlers } from '../src/main/ipc'
import { AgentTracker } from '../src/main/agent-tracker'
import type { PtyManager } from '../src/main/pty-manager'
import type { NotificationService } from '../src/main/notifications'
import type { PersistenceService } from '../src/main/persistence'
import type { BrowserWindow } from 'electron'

interface FakeWindow {
  sent: Array<[string, ...unknown[]]>
  isDestroyed: () => boolean
  webContents: { isDestroyed: () => boolean; send: (channel: string, ...args: unknown[]) => void }
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = {
    sent: [],
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, ...args) => win.sent.push([channel, ...args])
    }
  }
  return win
}

let current: FakeWindow | null = null
const tracker = new AgentTracker()
let onData: ((data: string) => void) | null = null
const ptyManager = {
  spawn: (_options: unknown, data: (d: string) => void) => {
    onData = data
    return true
  },
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn()
} as unknown as PtyManager
const notifications = {
  notify: vi.fn(),
  setBadge: vi.fn(),
  setFocusedPanel: vi.fn(),
  onPanelClick: vi.fn()
} as unknown as NotificationService
const persistence = {} as unknown as PersistenceService

const register = (): boolean =>
  registerIpcHandlers(
    () => current as unknown as BrowserWindow,
    ptyManager,
    tracker,
    notifications,
    persistence
  )

const counts = () => ({
  handlers: handlers.size,
  listeners: [...listeners.values()].reduce((n, l) => n + l.length, 0),
  statusListeners: tracker.listenerCount('status-change'),
  unreadListeners: tracker.listenerCount('unread-change')
})

describe('registerIpcHandlers', () => {
  let first: ReturnType<typeof counts>

  beforeAll(() => {
    current = fakeWindow()
    expect(register()).toBe(true)
    first = counts()
  })

  it('registers every channel once', () => {
    expect(first.handlers).toBeGreaterThan(5)
    expect(handlers.has('state:delete-scrollback')).toBe(true)
    expect(first.statusListeners).toBe(1)
    expect(first.unreadListeners).toBe(1)
  })

  it('refuses a second registration without throwing or adding listeners', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(register()).toBe(false)
    expect(register()).toBe(false)
    expect(counts()).toEqual(first)
    error.mockRestore()
  })

  it('after hide/show and a replaced window, each event reaches the current window once', async () => {
    const original = current!
    await handlers.get('pty:spawn')!({}, { id: 'p1', cwd: '/', cols: 80, rows: 24 })

    // Hidden window: same object, still receives output.
    onData!('while hidden')
    expect(original.sent.filter(([c]) => c === 'pty:data')).toEqual([['pty:data', 'p1', 'while hidden']])

    // A replacement window gets later events; the old one gets nothing more.
    const replacement = fakeWindow()
    current = replacement
    original.sent = []
    onData!('later')
    tracker.setStatus('p1', 'running')
    expect(original.sent).toEqual([])
    expect(replacement.sent).toEqual([
      ['pty:data', 'p1', 'later'],
      ['agent:status', 'p1', 'running', undefined]
    ])
  })

  it('drops events while no window exists', () => {
    current = null
    expect(() => onData!('nowhere')).not.toThrow()
    expect(() => tracker.setStatus('p1', 'idle')).not.toThrow()
  })
})
