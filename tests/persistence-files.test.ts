import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Saved terminal output and state on disk: owner-only permissions, atomic
// queued writes, deletion, and the startup sweep of orphaned files.

let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userData
  }
}))

import { PersistenceService, getDefaultState } from '../src/main/persistence'

const mode = (file: string): number => fs.statSync(file).mode & 0o777
const scrollbacks = (): string => path.join(userData, 'scrollbacks')
const stateFile = (): string => path.join(userData, 'workspace-state.json')
const logFile = (id: string): string => path.join(scrollbacks(), `${id}.log`)

function stateWithPanels(ids: string[]) {
  const state = getDefaultState()
  state.workspaces[0].panels = ids.map((id) => ({
    id,
    title: id,
    cwd: '/',
    agent: 'none' as const,
    shell: '/bin/zsh'
  }))
  state.workspaces[0].panelOrder = ids
  return state
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-files-'))
})

afterEach(() => {
  fs.chmodSync(userData, 0o700)
  if (fs.existsSync(scrollbacks())) fs.chmodSync(scrollbacks(), 0o700)
  fs.rmSync(userData, { recursive: true, force: true })
})

describe('permissions', () => {
  it('creates the scrollback directory 0700 and the state file 0600', () => {
    const service = new PersistenceService()
    service.loadState()
    expect(mode(scrollbacks())).toBe(0o700)
    expect(mode(stateFile())).toBe(0o600)
  })

  it('tightens files an older version left world-readable', () => {
    fs.mkdirSync(scrollbacks(), { mode: 0o755 })
    fs.chmodSync(scrollbacks(), 0o755)
    fs.writeFileSync(logFile('p1'), 'old', { mode: 0o644 })
    fs.writeFileSync(stateFile(), JSON.stringify(stateWithPanels(['p1'])), { mode: 0o644 })
    const backup = path.join(userData, 'workspace-state.v1-backup.json')
    fs.writeFileSync(backup, '{}', { mode: 0o644 })

    new PersistenceService()
    expect(mode(scrollbacks())).toBe(0o700)
    expect(mode(logFile('p1'))).toBe(0o600)
    expect(mode(stateFile())).toBe(0o600)
    expect(mode(backup)).toBe(0o600)
  })

  it('writes the migration backup and a corrupt-file backup 0600', () => {
    const v1 = { workspaces: [{ id: 'w', name: 'W', layout: { rows: 1, cols: 1 }, panels: [], panelOrder: [] }] }
    fs.writeFileSync(stateFile(), JSON.stringify(v1))
    const service = new PersistenceService()
    service.loadState()
    expect(mode(path.join(userData, 'workspace-state.v1-backup.json'))).toBe(0o600)
    expect(mode(stateFile())).toBe(0o600)

    fs.writeFileSync(stateFile(), '{ not json')
    fs.chmodSync(stateFile(), 0o644)
    service.loadState()
    const corrupt = fs.readdirSync(userData).find((n) => n.includes('.corrupt-'))!
    expect(mode(path.join(userData, corrupt))).toBe(0o600)
  })
})

describe('scrollback files', () => {
  it('saves owner-only through a temp file and loads it back', async () => {
    const service = new PersistenceService()
    expect(await service.saveScrollback('p1', 'hello')).toBe(true)
    expect(mode(logFile('p1'))).toBe(0o600)
    expect(fs.readdirSync(scrollbacks())).toEqual(['p1.log'])
    expect(await service.loadScrollback('p1')).toBe('hello')
    expect(await service.loadScrollback('missing')).toBeNull()
  })

  it('a failed write leaves the previous file intact and no temp file', async () => {
    const service = new PersistenceService()
    await service.saveScrollback('p1', 'good')
    fs.chmodSync(scrollbacks(), 0o500)
    expect(await service.saveScrollback('p1', 'new')).toBe(false)
    fs.chmodSync(scrollbacks(), 0o700)
    expect(fs.readFileSync(logFile('p1'), 'utf8')).toBe('good')
    expect(fs.readdirSync(scrollbacks())).toEqual(['p1.log'])
  })

  it('runs saves and deletes of a panel in the order they arrive', async () => {
    const service = new PersistenceService()
    const results = await Promise.all([
      service.saveScrollback('p1', 'a'.repeat(200_000)),
      service.saveScrollback('p1', 'b'),
      service.deleteScrollback('p1')
    ])
    expect(results).toEqual([true, true, true])
    expect(fs.existsSync(logFile('p1'))).toBe(false)

    await Promise.all([
      service.deleteScrollback('p2'),
      service.saveScrollback('p2', 'x'.repeat(200_000)),
      service.saveScrollback('p2', 'last')
    ])
    expect(fs.readFileSync(logFile('p2'), 'utf8')).toBe('last')
  })

  it('deleting a panel that has no file succeeds', async () => {
    const service = new PersistenceService()
    expect(await service.deleteScrollback('nothing')).toBe(true)
  })

  it('refuses panel ids that are not plain names', async () => {
    const service = new PersistenceService()
    expect(await service.saveScrollback('../escape', 'x')).toBe(false)
    expect(await service.saveScrollback('a/b', 'x')).toBe(false)
    expect(await service.deleteScrollback('..')).toBe(false)
    expect(await service.loadScrollback('../workspace-state')).toBeNull()
    expect(fs.existsSync(path.join(userData, 'escape.log'))).toBe(false)
  })
})

describe('orphan sweep', () => {
  function seedFiles(): void {
    fs.mkdirSync(scrollbacks(), { recursive: true })
    for (const name of ['p1.log', 'orphan.log', 'p2.log.tmp-123-1', 'notes.txt']) {
      fs.writeFileSync(path.join(scrollbacks(), name), name)
    }
  }

  it('removes files of panels missing from a cleanly loaded state, and stale temp files', () => {
    seedFiles()
    fs.writeFileSync(stateFile(), JSON.stringify(stateWithPanels(['p1', 'p2'])))
    new PersistenceService().loadState()
    expect(fs.readdirSync(scrollbacks()).sort()).toEqual(['notes.txt', 'p1.log'])
  })

  it('keeps everything when the state file is missing or corrupt', () => {
    seedFiles()
    new PersistenceService().loadState()
    expect(fs.readdirSync(scrollbacks())).toHaveLength(4)

    fs.writeFileSync(stateFile(), '{ broken')
    new PersistenceService().loadState()
    expect(fs.readdirSync(scrollbacks())).toHaveLength(4)
  })

  it('runs only on the first load: later loads never touch new panels', async () => {
    fs.writeFileSync(stateFile(), JSON.stringify(stateWithPanels(['p1'])))
    const service = new PersistenceService()
    service.loadState()
    // A panel created at runtime is saved before the state lists it.
    await service.saveScrollback('fresh', 'output')
    service.loadState()
    expect(fs.existsSync(logFile('fresh'))).toBe(true)
  })
})
