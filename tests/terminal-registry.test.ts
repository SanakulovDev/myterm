import { describe, it, expect, beforeEach } from 'vitest'
import {
  TerminalRegistry,
  TerminalHandle,
  TerminalApi
} from '../src/renderer/src/terminal/terminal-registry'
import { WebglBudget } from '../src/renderer/src/terminal/webgl-budget'
import { PanelConfig, SpawnPtyOptions } from '../src/shared/types'

// The registry is tested against fake terminals and a fake Electron API: the
// point is the lifecycle (what spawns, kills, renders and holds WebGL when).

class FakeTerminal implements TerminalHandle {
  cols = 80
  rows = 24
  container: unknown = null
  parked = false
  written = ''
  disposed = false
  webglActive = false
  webglCreated = 0
  refreshes = 0
  focused = 0
  fitSize: { cols: number; rows: number } | null = { cols: 100, rows: 30 }
  dataListener: ((data: string) => void) | null = null
  contextLoss: (() => void) | null = null

  mountIn(container: HTMLElement): void {
    this.container = container
    this.parked = false
  }
  park(): void {
    this.container = null
    this.parked = true
  }
  write(data: string): void {
    this.written += data
  }
  onData(listener: (data: string) => void): void {
    this.dataListener = listener
  }
  fit(): boolean {
    if (!this.fitSize) return false
    this.cols = this.fitSize.cols
    this.rows = this.fitSize.rows
    return true
  }
  refresh(): void {
    this.refreshes++
  }
  focus(): void {
    this.focused++
  }
  serialize(): string {
    return `serialized:${this.written}`
  }
  findNext(): boolean {
    return true
  }
  findPrevious(): boolean {
    return true
  }
  attachWebgl(onContextLoss: () => void) {
    this.webglActive = true
    this.webglCreated++
    this.contextLoss = onContextLoss
    return {
      dispose: () => {
        this.webglActive = false
      }
    }
  }
  debugInfo() {
    return { cols: this.cols, rows: this.rows, cursorX: 0, cursorY: 0, bufferLength: 0, text: '' }
  }
  dispose(): void {
    this.disposed = true
  }
}

class FakeApi implements TerminalApi {
  spawns: SpawnPtyOptions[] = []
  resizes: Array<[string, number, number]> = []
  writes: Array<[string, string]> = []
  saved = new Map<string, string>()
  scrollbacks = new Map<string, string>()
  dataListener: ((id: string, data: string) => void) | null = null

  spawnPty = async (options: SpawnPtyOptions) => {
    this.spawns.push(options)
    return true
  }
  writePty = (id: string, data: string) => {
    this.writes.push([id, data])
  }
  resizePty = (id: string, cols: number, rows: number) => {
    this.resizes.push([id, cols, rows])
  }
  onPtyData = (callback: (id: string, data: string) => void) => {
    this.dataListener = callback
    return () => {
      this.dataListener = null
    }
  }
  loadScrollback = async (id: string) => this.scrollbacks.get(id) ?? null
  saveScrollback = async (id: string, content: string) => {
    this.saved.set(id, content)
    return true
  }
  emit(id: string, data: string): void {
    this.dataListener?.(id, data)
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function panel(id: string, overrides: Partial<PanelConfig> = {}): PanelConfig {
  return { id, title: id, cwd: '/proj', agent: 'none', shell: '/bin/zsh', ...overrides }
}

let api: FakeApi
let budget: WebglBudget
let terminals: Map<string, FakeTerminal>
let registry: TerminalRegistry
let creating: string | null

function container(name: string): HTMLElement {
  return { name } as unknown as HTMLElement
}

/** Mounts a panel the way TerminalPanel does: attach, then show (or hide). */
function mount(p: PanelConfig, slot = container(p.id), visible = true): HTMLElement {
  creating = p.id
  registry.attach(p.id, slot)
  registry.setVisible(p, visible)
  creating = null
  return slot
}

beforeEach(() => {
  api = new FakeApi()
  budget = new WebglBudget(12)
  terminals = new Map()
  registry = new TerminalRegistry({
    api,
    budget,
    createTerminal: () => {
      const term = new FakeTerminal()
      terminals.set(creating ?? `unknown-${terminals.size}`, term)
      return term
    }
  })
})

describe('TerminalRegistry lifecycle', () => {
  it('creates the session on first show and spawns one PTY at the fitted size', async () => {
    mount(panel('p1'))
    await settle()

    expect(terminals.size).toBe(1)
    expect(api.spawns).toEqual([
      { id: 'p1', cwd: '/proj', shell: '/bin/zsh', launch: undefined, cols: 100, rows: 30 }
    ])
    expect(budget.has('p1')).toBe(true)
  })

  it('restores saved scrollback before spawning the shell', async () => {
    api.scrollbacks.set('p1', 'old output\r\n')
    mount(panel('p1'))
    await settle()

    expect(terminals.get('p1')!.written).toBe('old output\r\n')
    expect(api.spawns).toHaveLength(1)
  })

  it('never spawns or kills a PTY across workspace switches; hidden panels keep receiving output', async () => {
    // Three workspaces with three panels each; only one workspace is mounted.
    const workspaces = ['a', 'b', 'c'].map((w) => [1, 2, 3].map((n) => panel(`${w}${n}`)))
    const mountWorkspace = (ws: PanelConfig[]) => ws.map((p) => [p, mount(p)] as const)
    const unmountWorkspace = (mounted: ReadonlyArray<readonly [PanelConfig, HTMLElement]>) =>
      mounted.forEach(([p, slot]) => registry.detach(p.id, slot))

    let mounted = mountWorkspace(workspaces[0])
    await settle()
    for (const ws of [workspaces[1], workspaces[2], workspaces[0], workspaces[2], workspaces[1]]) {
      unmountWorkspace(mounted)
      // Output for a panel of a workspace that is not shown still lands in its buffer.
      api.emit('a1', 'tick;')
      mounted = mountWorkspace(ws)
      await settle()
      expect(budget.size).toBeLessThanOrEqual(3)
    }

    expect(api.spawns.map((s) => s.id).sort()).toEqual(
      workspaces.flat().map((p) => p.id).sort()
    )
    expect(terminals.size).toBe(9)
    expect([...terminals.values()].some((t) => t.disposed)).toBe(false)
    expect(terminals.get('a1')!.written).toBe('tick;'.repeat(5))
    expect(budget.size).toBe(3)
    expect(registry.debugSessions().filter((s) => s.webgl).map((s) => s.id).sort()).toEqual(
      ['b1', 'b2', 'b3']
    )
    expect(terminals.get('a1')!.parked).toBe(true)
    expect(terminals.get('a1')!.webglActive).toBe(false)
  })

  it('a React remount (StrictMode) reuses the session', async () => {
    const p = panel('p1')
    const slot = mount(p)
    registry.detach('p1', slot)
    mount(p, slot)
    await settle()

    expect(terminals.size).toBe(1)
    expect(api.spawns).toHaveLength(1)
    expect(terminals.get('p1')!.container).toBe(slot)
  })

  it('ignores a stale detach after the panel mounted elsewhere', async () => {
    const p = panel('p1')
    const oldSlot = mount(p)
    const newSlot = container('new')
    registry.attach('p1', newSlot)
    registry.detach('p1', oldSlot)

    expect(terminals.get('p1')!.container).toBe(newSlot)
    expect(terminals.get('p1')!.parked).toBe(false)
  })

  it('maximize hides the others: they release WebGL but keep their PTY', async () => {
    const panels = [panel('p1'), panel('p2'), panel('p3')]
    panels.forEach((p) => mount(p))
    await settle()

    registry.setVisible(panels[1], false)
    registry.setVisible(panels[2], false)
    expect(budget.size).toBe(1)
    api.emit('p2', 'while hidden')

    panels.forEach((p) => registry.setVisible(p, true))
    expect(budget.size).toBe(3)
    expect(terminals.get('p2')!.written).toBe('while hidden')
    expect(terminals.get('p2')!.refreshes).toBe(2)
    expect(api.spawns).toHaveLength(3)
  })

  it('does not create a session for a panel that mounts hidden', async () => {
    mount(panel('p1'), container('p1'), false)
    await settle()
    expect(terminals.size).toBe(0)
    expect(api.spawns).toHaveLength(0)

    registry.setVisible(panel('p1'), true)
    await settle()
    expect(api.spawns).toHaveLength(1)
  })

  it('caps WebGL renderers; extra visible panels use the DOM renderer', async () => {
    for (let i = 0; i < 15; i++) mount(panel(`p${i}`))
    await settle()
    expect(budget.size).toBe(12)
    expect(registry.debugSessions().filter((s) => s.visible)).toHaveLength(15)
  })

  it('falls back after a WebGL context loss and retries on the next show', () => {
    const p = panel('p1')
    mount(p)
    const term = terminals.get('p1')!
    term.contextLoss!()
    expect(budget.has('p1')).toBe(false)
    expect(term.webglActive).toBe(false)

    registry.setVisible(p, false)
    registry.setVisible(p, true)
    expect(term.webglCreated).toBe(2)
    expect(budget.has('p1')).toBe(true)
  })

  it('resizes the PTY only when a fit changes its size, and never while hidden', async () => {
    const p = panel('p1')
    mount(p)
    await settle()
    const term = terminals.get('p1')!

    registry.fit('p1')
    expect(api.resizes).toEqual([])

    term.fitSize = { cols: 120, rows: 40 }
    registry.fit('p1')
    expect(api.resizes).toEqual([['p1', 120, 40]])

    registry.setVisible(p, false)
    term.fitSize = { cols: 50, rows: 10 }
    registry.fit('p1')
    expect(api.resizes).toHaveLength(1)

    term.fitSize = null // no usable size
    registry.setVisible(p, true)
    expect(api.resizes).toHaveLength(1)
  })

  it('forwards terminal input to the PTY and drops output for unknown panels', () => {
    mount(panel('p1'))
    terminals.get('p1')!.dataListener!('ls\r')
    expect(api.writes).toEqual([['p1', 'ls\r']])
    api.emit('ghost', 'x')
  })
})

describe('TerminalRegistry agent launch', () => {
  const agentPanel = (id: string) =>
    panel(id, { agent: 'claude', agentCommand: 'claude', agentArgs: '--verbose' })

  it('auto-launches only a panel marked pending, exactly once', async () => {
    registry.markLaunchPending('new')
    const p = agentPanel('new')
    const slot = mount(p)
    await settle()
    registry.detach('new', slot)
    mount(p, slot)
    await settle()

    expect(api.spawns).toHaveLength(1)
    expect(api.spawns[0].launch).toEqual({ command: 'claude', args: '--verbose' })
    expect(registry.isLaunchPending('new')).toBe(false)
  })

  it('starts a restored agent panel as a plain shell', async () => {
    mount(agentPanel('restored'))
    await settle()
    expect(api.spawns).toHaveLength(1)
    expect(api.spawns[0].launch).toBeUndefined()
  })

  it('Launch respawns through the launch script and keeps the terminal', async () => {
    const p = agentPanel('p1')
    mount(p)
    await settle()
    const term = terminals.get('p1')!

    registry.launch(p)
    await settle()
    expect(api.spawns).toHaveLength(2)
    expect(api.spawns[1].launch).toEqual({ command: 'claude', args: '--verbose' })
    expect(term.written).toContain('[Agent Terminal] Starting claude')
    expect(terminals.size).toBe(1)
  })

  it('Launch is a no-op for shell panels', async () => {
    const p = panel('p1')
    mount(p)
    await settle()
    registry.launch(p)
    expect(api.spawns).toHaveLength(1)
  })

  it('a Launch before the first spawn replaces the plain spawn', async () => {
    const p = agentPanel('p1')
    mount(p)
    registry.launch(p)
    await settle()
    expect(api.spawns).toHaveLength(1)
    expect(api.spawns[0].launch).toBeDefined()
  })

  it('respawns only when cwd or shell changes', async () => {
    const p = panel('p1')
    mount(p)
    await settle()
    registry.syncSpawnConfig({ ...p, title: 'renamed' })
    expect(api.spawns).toHaveLength(1)
    registry.syncSpawnConfig({ ...p, cwd: '/other' })
    await settle()
    expect(api.spawns).toHaveLength(2)
    expect(api.spawns[1].cwd).toBe('/other')
  })
})

describe('TerminalRegistry close and flush', () => {
  it('destroy disposes the terminal and releases WebGL; later output is dropped', async () => {
    mount(panel('p1'))
    await settle()
    const term = terminals.get('p1')!
    registry.destroy('p1')

    expect(term.disposed).toBe(true)
    expect(budget.size).toBe(0)
    api.emit('p1', 'late')
    expect(term.written).toBe('')
    expect(registry.debugSessions()).toEqual([])
  })

  it('destroy before the scrollback loads skips the spawn', async () => {
    mount(panel('p1'))
    registry.destroy('p1')
    await settle()
    expect(api.spawns).toHaveLength(0)
  })

  it('flushScrollback saves every session, shown or not', async () => {
    const a = mount(panel('a'))
    mount(panel('b'))
    await settle()
    registry.detach('a', a)
    api.emit('a', 'hidden output')

    await registry.flushScrollback()
    expect(api.saved.get('a')).toBe('serialized:hidden output')
    expect(api.saved.get('b')).toBe('serialized:')
  })
})
