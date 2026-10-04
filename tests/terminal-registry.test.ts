import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PROMPT_SUBMIT_DELAY_MS,
  TerminalRegistry,
  TerminalHandle,
  TerminalApi,
  getLaunchSpec
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
  // xterm sends a paste to its data listeners, like typed input.
  paste(text: string): void {
    this.dataListener?.(text)
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
    return {
      cols: this.cols,
      rows: this.rows,
      fontFamily: '',
      fontSize: 0,
      unicodeVersion: '6',
      cursorX: 0,
      cursorY: 0,
      bufferLength: 0,
      text: ''
    }
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
  saveCalls: string[] = []
  deleted: string[] = []
  // Makes the next saves fail: 'reject' throws, 'false' reports failure.
  failSaves: 'reject' | 'false' | null = null
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
    this.saveCalls.push(id)
    if (this.failSaves === 'reject') throw new Error('disk full')
    if (this.failSaves === 'false') return false
    this.saved.set(id, content)
    return true
  }
  deleteScrollback = async (id: string) => {
    this.deleted.push(id)
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
    idle: async () => undefined,
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

  it('passes a first prompt with the agent flag, once', async () => {
    registry.markLaunchPending('g', 'fix the -x bug')
    const p = panel('g', { agent: 'gemini', agentCommand: 'gemini' })
    const slot = mount(p)
    await settle()
    registry.detach('g', slot)
    mount(p, slot)
    await settle()

    expect(api.spawns).toHaveLength(1)
    expect(api.spawns[0].launch).toEqual({
      command: 'gemini',
      args: undefined,
      prompt: 'fix the -x bug',
      promptFlag: '-i'
    })
  })

  it('Launch with a prompt restarts the agent with it', async () => {
    const p = agentPanel('p1')
    mount(p)
    await settle()
    registry.launch(p, 'hello')
    await settle()
    expect(api.spawns[1].launch).toEqual({
      command: 'claude',
      args: '--verbose',
      prompt: 'hello',
      promptFlag: ''
    })
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

  it('flushScrollback saves every changed session, shown or not', async () => {
    const a = mount(panel('a'))
    mount(panel('b'))
    mount(panel('c'))
    await settle()
    registry.detach('a', a)
    api.emit('a', 'hidden output')
    api.emit('b', 'shown output')

    await registry.flushScrollback()
    expect(api.saved.get('a')).toBe('serialized:hidden output')
    expect(api.saved.get('b')).toBe('serialized:shown output')
    // Unchanged since it started: its file is already current.
    expect(api.saved.has('c')).toBe(false)
  })

  it('destroy deletes the saved output, also of a panel never shown', async () => {
    mount(panel('p1'))
    await settle()
    registry.destroy('p1')
    registry.destroy('never-shown')
    expect(api.deleted).toEqual(['p1', 'never-shown'])
  })
})

describe('TerminalRegistry autosave', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restored scrollback does not count as a change; PTY output does', async () => {
    api.scrollbacks.set('p1', 'old output')
    mount(panel('p1'))
    await settle()
    await registry.autosave()
    expect(api.saveCalls).toEqual([])

    api.emit('p1', 'new output')
    await registry.autosave()
    expect(api.saved.get('p1')).toBe('serialized:old outputnew output')

    // Nothing new since: the next pass writes nothing.
    await registry.autosave()
    expect(api.saveCalls).toEqual(['p1'])
  })

  it('saves only changed sessions, including hidden ones', async () => {
    const a = mount(panel('a'))
    mount(panel('b'))
    await settle()
    registry.detach('a', a)
    api.emit('a', 'x')
    await registry.autosave()
    expect(api.saveCalls).toEqual(['a'])
  })

  it('waits for an idle slot before each panel', async () => {
    const slots: Array<() => void> = []
    registry = new TerminalRegistry({
      api,
      budget,
      createTerminal: () => new FakeTerminal(),
      idle: () => new Promise<void>((resolve) => slots.push(resolve))
    })
    mount(panel('a'))
    mount(panel('b'))
    await settle()
    api.emit('a', 'x')
    api.emit('b', 'y')

    const pass = registry.autosave()
    await settle()
    expect(slots).toHaveLength(1)
    expect(api.saveCalls).toEqual([])
    slots[0]()
    await settle()
    expect(api.saveCalls).toEqual(['a'])
    expect(slots).toHaveLength(2)
    slots[1]()
    await pass
    expect(api.saveCalls).toEqual(['a', 'b'])
  })

  it.each(['reject', 'false'] as const)(
    'a failed save (%s) keeps the panel dirty and the next pass retries',
    async (failure) => {
      mount(panel('p1'))
      await settle()
      api.emit('p1', 'data')

      api.failSaves = failure
      await registry.autosave()
      expect(api.saved.has('p1')).toBe(false)
      expect(registry.debugSessions()[0].dirty).toBe(true)

      api.failSaves = null
      await registry.autosave()
      expect(api.saved.get('p1')).toBe('serialized:data')
      expect(registry.debugSessions()[0].dirty).toBe(false)
    }
  )

  it('a serialize failure keeps the panel dirty', async () => {
    mount(panel('p1'))
    await settle()
    api.emit('p1', 'data')
    const term = terminals.get('p1')!
    term.serialize = () => {
      throw new Error('serialize failed')
    }
    await registry.autosave()
    expect(api.saveCalls).toEqual([])
    expect(registry.debugSessions()[0].dirty).toBe(true)
  })

  it('output during a save marks the panel again', async () => {
    mount(panel('p1'))
    await settle()
    api.emit('p1', 'first')
    let release: () => void = () => undefined
    api.saveScrollback = async (id: string, content: string) => {
      api.saveCalls.push(id)
      await new Promise<void>((resolve) => (release = resolve))
      api.saved.set(id, content)
      return true
    }
    const pass = registry.autosave()
    await settle()
    api.emit('p1', 'second')
    release()
    await pass
    expect(api.saved.get('p1')).toBe('serialized:first')
    expect(registry.debugSessions()[0].dirty).toBe(true)
  })

  it('skips a panel closed while waiting for its idle slot', async () => {
    let slot: () => void = () => undefined
    registry = new TerminalRegistry({
      api,
      budget,
      createTerminal: () => new FakeTerminal(),
      idle: () => new Promise<void>((resolve) => (slot = resolve))
    })
    mount(panel('p1'))
    await settle()
    api.emit('p1', 'x')
    const pass = registry.autosave()
    await settle()
    registry.destroy('p1')
    slot()
    await pass
    expect(api.saveCalls).toEqual([])
  })

  it('a flush waits for a save already in flight', async () => {
    mount(panel('p1'))
    await settle()
    api.emit('p1', 'data')
    let release: () => void = () => undefined
    api.saveScrollback = async (id: string, content: string) => {
      await new Promise<void>((resolve) => (release = resolve))
      api.saved.set(id, content)
      return true
    }
    void registry.autosave()
    await settle()
    let flushed = false
    const flush = registry.flushScrollback().then(() => (flushed = true))
    await settle()
    expect(flushed).toBe(false)
    release()
    await flush
    expect(api.saved.get('p1')).toBe('serialized:data')
  })

  it('startAutosave runs a pass every interval until stopped', async () => {
    vi.useFakeTimers()
    mount(panel('p1'))
    await vi.advanceTimersByTimeAsync(0)
    const stop = registry.startAutosave(30_000)
    api.emit('p1', 'a')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(api.saveCalls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(api.saveCalls).toEqual(['p1'])

    stop()
    api.emit('p1', 'b')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.saveCalls).toEqual(['p1'])
  })
})

describe('getLaunchSpec', () => {
  it('drops a prompt for agents that cannot take one', () => {
    expect(getLaunchSpec(panel('a', { agent: 'aider', agentCommand: 'aider' }), 'x')).toEqual({
      command: 'aider',
      args: undefined
    })
    expect(getLaunchSpec(panel('c', { agent: 'custom', agentCommand: 'my-bot' }), 'x')).toEqual({
      command: 'my-bot',
      args: undefined
    })
  })

  it('ignores a blank prompt and never launches a shell panel', () => {
    expect(getLaunchSpec(panel('a', { agent: 'claude' }), '   ')).toEqual({
      command: 'claude',
      args: undefined
    })
    expect(getLaunchSpec(panel('s'), 'x')).toBeUndefined()
  })

  it('runs an agent id this version does not know by its command', () => {
    const p = panel('n', { agent: 'future-agent' as PanelConfig['agent'], agentCommand: 'fa' })
    expect(getLaunchSpec(p, 'x')).toEqual({ command: 'fa', args: undefined })
  })
})

describe('TerminalRegistry sendPrompt', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pastes the text, then presses Enter after a pause', async () => {
    mount(panel('p1', { agent: 'claude' }))
    await settle()
    vi.useFakeTimers()

    expect(registry.sendPrompt('p1', 'line one\nline two')).toBe(true)
    expect(api.writes).toEqual([['p1', 'line one\nline two']])
    vi.advanceTimersByTime(PROMPT_SUBMIT_DELAY_MS)
    expect(api.writes).toEqual([
      ['p1', 'line one\nline two'],
      ['p1', '\r']
    ])
  })

  it('can type without submitting', async () => {
    mount(panel('p1'))
    await settle()
    vi.useFakeTimers()
    registry.sendPrompt('p1', 'ls', false)
    vi.advanceTimersByTime(PROMPT_SUBMIT_DELAY_MS * 2)
    expect(api.writes).toEqual([['p1', 'ls']])
  })

  it('does nothing for a panel without a terminal, and no Enter after a close', async () => {
    expect(registry.sendPrompt('ghost', 'x')).toBe(false)
    mount(panel('p1'))
    await settle()
    vi.useFakeTimers()
    registry.sendPrompt('p1', 'x')
    registry.destroy('p1')
    vi.advanceTimersByTime(PROMPT_SUBMIT_DELAY_MS)
    expect(api.writes).toEqual([['p1', 'x']])
  })
})
