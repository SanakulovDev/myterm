import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock electron app.getPath
const tmpDir = path.join(os.tmpdir(), `myterm-test-${Date.now()}`)
fs.mkdirSync(tmpDir, { recursive: true })

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir
  }
}))

import {
  PersistenceService,
  getDefaultState,
  migrateState,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_AGENT_SETTINGS
} from '../src/main/persistence'

describe('PersistenceService', () => {
  it('returns default state when no file exists', () => {
    const service = new PersistenceService()
    const state = service.loadState()
    expect(state).toBeDefined()
    expect(state.workspaces.length).toBeGreaterThan(0)
    expect(state.schemaVersion).toBe(3)
  })

  it('saves and reloads state atomically', () => {
    const service = new PersistenceService()
    const state = getDefaultState()
    state.activeWorkspaceId = 'ws-custom'
    state.workspaces[0].name = 'Custom Workspace'

    const saved = service.saveState(state)
    expect(saved).toBe(true)

    const loaded = service.loadState()
    expect(loaded.activeWorkspaceId).toBe('ws-custom')
    expect(loaded.workspaces[0].name).toBe('Custom Workspace')
  })

  it('recovers gracefully from corrupted JSON file by restoring defaults', () => {
    const service = new PersistenceService()
    const stateFile = path.join(tmpDir, 'workspace-state.json')
    fs.writeFileSync(stateFile, '{ corrupted JSON content: !!!', 'utf8')

    const loaded = service.loadState()
    expect(loaded).toBeDefined()
    expect(loaded.schemaVersion).toBe(3)
    expect(loaded.workspaces.length).toBeGreaterThan(0)
  })

  it('migrates a v1 file on load: backup first, runtime fields stripped, saved as current', () => {
    const service = new PersistenceService()
    const stateFile = path.join(tmpDir, 'workspace-state.json')
    const backupFile = path.join(tmpDir, 'workspace-state.v1-backup.json')
    const v1Raw = JSON.stringify(v1State())
    fs.writeFileSync(stateFile, v1Raw, 'utf8')

    const loaded = service.loadState()
    expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(loaded.agentSettings).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(loaded.workspaces[0].panels[0]).not.toHaveProperty('status')

    expect(fs.readFileSync(backupFile, 'utf8')).toBe(v1Raw)
    const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    expect(onDisk.schemaVersion).toBe(3)
    expect(onDisk.workspaces[0].panels[0]).not.toHaveProperty('unread')

    // The backup is one-time: a later migration does not overwrite it.
    fs.writeFileSync(stateFile, JSON.stringify({ ...v1State(), lastUsedFolder: '/other' }), 'utf8')
    service.loadState()
    expect(fs.readFileSync(backupFile, 'utf8')).toBe(v1Raw)
  })

  it('backs up a v2 file under its own version before the v3 save', () => {
    const service = new PersistenceService()
    const stateFile = path.join(tmpDir, 'workspace-state.json')
    const backupFile = path.join(tmpDir, 'workspace-state.v2-backup.json')
    fs.rmSync(backupFile, { force: true })
    const v2Raw = JSON.stringify({ ...v1State(), schemaVersion: 2 })
    fs.writeFileSync(stateFile, v2Raw, 'utf8')

    const loaded = service.loadState()
    expect(loaded.workspaces[0].layout).toEqual({ mode: 'stack', rows: 1, cols: 2 })
    expect(fs.readFileSync(backupFile, 'utf8')).toBe(v2Raw)
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).schemaVersion).toBe(3)
  })

  it('never writes runtime panel fields', () => {
    const service = new PersistenceService()
    const state = getDefaultState()
    Object.assign(state.workspaces[0].panels[0], { status: 'running', unread: true, autoLaunch: true })
    service.saveState(state)

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'workspace-state.json'), 'utf8'))
    const panel = onDisk.workspaces[0].panels[0]
    expect(panel).not.toHaveProperty('status')
    expect(panel).not.toHaveProperty('unread')
    expect(panel).not.toHaveProperty('autoLaunch')
  })
})

function v1State(): Record<string, unknown> {
  return {
    workspaces: [
      {
        id: 'ws-1',
        name: 'Old',
        layout: { rows: 1, cols: 2 },
        panels: [
          {
            id: 'p-1',
            title: 'Claude',
            cwd: '/tmp',
            agent: 'claude',
            agentCommand: 'claude',
            shell: '/bin/zsh',
            autoLaunch: true,
            status: 'running',
            unread: true,
            customField: 42
          },
          { id: 'p-2', title: 'Shell', cwd: '/tmp', agent: 'none', shell: '' }
        ],
        panelOrder: ['p-1', 'p-2']
      }
    ],
    activeWorkspaceId: 'ws-1',
    window: { width: 1000, height: 700 },
    schemaVersion: 1
  }
}

describe('migrateState', () => {
  const SHELL = '/bin/test-shell'

  it('strips runtime fields, keeps unknown fields and fills defaults', () => {
    const migrated = migrateState(v1State(), SHELL)!
    expect(migrated.schemaVersion).toBe(3)
    const [p1, p2] = migrated.workspaces[0].panels
    expect(p1).toEqual({
      id: 'p-1',
      title: 'Claude',
      cwd: '/tmp',
      agent: 'claude',
      agentCommand: 'claude',
      shell: '/bin/zsh',
      customField: 42
    })
    expect(p2.shell).toBe(SHELL)
    expect(migrated.agentSettings).toEqual(DEFAULT_AGENT_SETTINGS)
    expect(migrated.window).toEqual({ width: 1000, height: 700 })
  })

  it('treats a missing schemaVersion as v1', () => {
    const raw = v1State()
    delete raw.schemaVersion
    expect(migrateState(raw, SHELL)!.schemaVersion).toBe(3)
  })

  it('v3: older workspaces become stacks that keep their grid preset', () => {
    const raw = { ...v1State(), schemaVersion: 2 }
    ;(raw.workspaces as Record<string, unknown>[])[0].layout = { rows: 2, cols: 3 }
    const migrated = migrateState(raw, SHELL)!
    expect(migrated.workspaces[0].layout).toEqual({ mode: 'stack', rows: 2, cols: 3 })
    expect(migrated.workspaces[0].rootPath).toBeUndefined()
    expect(migrated.ui).toEqual({
      sidebarVisible: true,
      sidebarWidth: 264,
      collapsedWorkspaceIds: [],
      rightSlotWidth: 360
    })
  })

  it('v3: keeps a saved mode, rootPath and ui, and repairs bad values', () => {
    const raw = {
      ...v1State(),
      schemaVersion: 3,
      ui: { sidebarVisible: false, sidebarWidth: 9999, collapsedWorkspaceIds: ['ws-1', 7], rightSlotWidth: 'x' }
    }
    const ws = (raw.workspaces as Record<string, unknown>[])[0]
    ws.layout = { mode: 'grid', rows: 0, cols: 3 }
    ws.rootPath = '/tmp/project'
    const migrated = migrateState(raw, SHELL)!
    expect(migrated.workspaces[0].layout).toEqual({ mode: 'grid', rows: 1, cols: 3 })
    expect(migrated.workspaces[0].rootPath).toBe('/tmp/project')
    expect(migrated.ui).toEqual({
      sidebarVisible: false,
      sidebarWidth: 400,
      collapsedWorkspaceIds: ['ws-1'],
      rightSlotWidth: 360
    })
  })

  it('deep-merges partial agentSettings with defaults', () => {
    const migrated = migrateState(
      { ...v1State(), agentSettings: { claude: { command: '/opt/bin/claude' }, extra: true } },
      SHELL
    )!
    expect(migrated.agentSettings).toEqual({
      claude: { command: '/opt/bin/claude', args: '' },
      codex: { command: 'codex', args: '' },
      extra: true
    })
  })

  it('is idempotent', () => {
    const once = migrateState(v1State(), SHELL)
    expect(migrateState(once, SHELL)).toEqual(once)
  })

  it('does not mutate its input', () => {
    const raw = v1State()
    const copy = JSON.parse(JSON.stringify(raw))
    migrateState(raw, SHELL)
    expect(raw).toEqual(copy)
  })

  it('loads a newer schema best-effort and keeps its version and fields', () => {
    const migrated = migrateState({ ...v1State(), schemaVersion: 4, futureThing: { a: 1 } }, SHELL)!
    expect(migrated.schemaVersion).toBe(4)
    expect((migrated as unknown as Record<string, unknown>).futureThing).toEqual({ a: 1 })
  })

  it('returns null when there is nothing usable', () => {
    expect(migrateState(null, SHELL)).toBeNull()
    expect(migrateState('nope', SHELL)).toBeNull()
    expect(migrateState({ workspaces: [] }, SHELL)).toBeNull()
  })
})
