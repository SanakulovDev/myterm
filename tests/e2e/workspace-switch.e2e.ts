import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, RunningApp, Cdp, delay, isProcessAlive } from './harness'

// Three workspaces with three panels each. Panel a1 is a (restored) agent
// panel whose agent is the fake agent in --tick mode.

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-agent.sh')
const WORKSPACES = [
  { key: 'a', name: 'Alpha' },
  { key: 'b', name: 'Beta' },
  { key: 'c', name: 'Gamma' }
]
const SEEDED_IDS = WORKSPACES.flatMap(({ key }) => [1, 2, 3].map((n) => `${key}${n}`))

interface SessionInfo {
  id: string
  visible: boolean
  attached: boolean
  webgl: boolean
  spawns: number
}

interface TerminalInfo {
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  bufferLength: number
  text: string
  serialized: string
}

let root: string
let userDataDir: string
let projectDir: string
let app: RunningApp
let cdp: Cdp

const sessions = () => cdp.eval<SessionInfo[]>('window.__myterm.sessions()')
const terminal = (id: string) => cdp.eval<TerminalInfo>(`window.__myterm.terminal(${JSON.stringify(id)})`)
const webglCount = () => cdp.eval<number>('window.__myterm.webglCount()')
/** Live WebGL contexts in the page, whether or not their canvas is still attached. */
const liveContexts = () => cdp.eval<number>('window.__gl.filter((gl) => !gl.isContextLost()).length')
const statusOf = (id: string) => cdp.eval<string | undefined>(`window.__st[${JSON.stringify(id)}]`)
const statusHistory = (id: string) =>
  cdp.eval<string[]>(`window.__sth.filter((e) => e[0] === ${JSON.stringify(id)}).map((e) => e[1])`)
const spawnsOf = async (id: string) => (await sessions()).find((s) => s.id === id)?.spawns

function waitForText(id: string, text: string, timeoutMs = 15000): Promise<unknown> {
  return cdp.waitFor(
    `window.__myterm.terminal(${JSON.stringify(id)})?.text.includes(${JSON.stringify(text)})`,
    `${JSON.stringify(text)} in ${id}`,
    timeoutMs
  )
}

/** Clicks a workspace in the sidebar and waits until its panels are shown. */
async function switchTo(key: string): Promise<void> {
  await cdp.eval(`document.querySelector('[data-workspace-id="ws-${key}"]').click()`)
  await cdp.waitFor(
    `(() => {
      const shown = window.__myterm.sessions().filter((s) => s.visible).map((s) => s.id).sort().join()
      return shown === ${JSON.stringify([1, 2, 3].map((n) => `${key}${n}`).join())}
    })()`,
    `workspace ${key} shown`
  )
}

function ticks(text: string): number[] {
  return [...text.matchAll(/FAKE_AGENT_TICK (\d+)/g)].map((m) => Number(m[1]))
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-e2e-')))
  userDataDir = path.join(root, 'user-data')
  projectDir = path.join(root, 'project')
  const zdotdir = path.join(root, 'zdotdir')
  fs.mkdirSync(userDataDir)
  fs.mkdirSync(projectDir)
  fs.mkdirSync(zdotdir)
  // An rc file must exist, or zsh opens its new-user menu.
  fs.writeFileSync(path.join(zdotdir, '.zshrc'), "PS1='e2e%# '\n")

  const agentPath = path.join(root, 'fake-agent.sh')
  fs.copyFileSync(FIXTURE, agentPath)
  fs.chmodSync(agentPath, 0o755)

  const state = {
    schemaVersion: 2,
    activeWorkspaceId: 'ws-a',
    lastUsedFolder: projectDir,
    agentSettings: { claude: { command: agentPath, args: '--tick' }, codex: { command: 'codex' } },
    window: { width: 1400, height: 900 },
    workspaces: WORKSPACES.map(({ key, name }) => {
      const panels = [1, 2, 3].map((n) => {
        const isAgent = key === 'a' && n === 1
        return {
          id: `${key}${n}`,
          title: `${name} ${n}`,
          cwd: projectDir,
          agent: isAgent ? 'claude' : 'none',
          ...(isAgent ? { agentCommand: agentPath, agentArgs: '--tick' } : {}),
          shell: '/bin/zsh'
        }
      })
      return {
        id: `ws-${key}`,
        name,
        layout: { rows: 1, cols: 3 },
        panels,
        panelOrder: panels.map((p) => p.id)
      }
    })
  }
  fs.writeFileSync(path.join(userDataDir, 'workspace-state.json'), JSON.stringify(state, null, 2))

  app = await launchApp(userDataDir, { ZDOTDIR: zdotdir })
  cdp = app.cdp
  await cdp.waitFor('window.__myterm && window.__myterm.sessions().length === 3', 'first workspace')
  // Track every WebGL context: the ones already open (getContext returns a
  // canvas's existing context, or null for 2D canvases) and all new ones.
  await cdp.eval(`(() => {
    window.__gl = []
    const track = (gl) => {
      if (gl && !window.__gl.includes(gl)) window.__gl.push(gl)
      return gl
    }
    for (const canvas of document.querySelectorAll('canvas')) track(canvas.getContext('webgl2'))
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const ctx = getContext.call(this, type, ...rest)
      return type === 'webgl' || type === 'webgl2' ? track(ctx) : ctx
    }
    window.__st = {}
    window.__sth = []
    window.electronAPI.onAgentStatus((id, status) => {
      window.__st[id] = status
      window.__sth.push([id, status])
    })
  })()`)
})

afterAll(async () => {
  await app?.stop()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('workspace switching keeps terminals alive', () => {
  it('shows only the active workspace, with one WebGL renderer per visible panel', async () => {
    const list = await sessions()
    expect(list.map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3'])
    expect(list.every((s) => s.visible && s.webgl && s.spawns === 1)).toBe(true)
    expect(await webglCount()).toBe(3)
    expect(await liveContexts()).toBe(3)
  })

  it('does not auto-launch a restored agent panel', async () => {
    await waitForText('a1', 'e2e%')
    expect((await terminal('a1')).text).not.toContain('FAKE_AGENT')
    expect(await spawnsOf('a1')).toBe(1)
  })

  let agentPid = 0

  it('keeps a running agent alive and its output flowing across switches', async () => {
    await cdp.eval(`document.querySelector('[data-panel-id="a1"] button[title^="Launch"]').click()`)
    await waitForText('a1', 'FAKE_AGENT_TICK 3')
    expect(await statusOf('a1')).toBe('running')
    agentPid = Number(/FAKE_AGENT_PID=(\d+)/.exec((await terminal('a1')).text)![1])
    expect(isProcessAlive(agentPid)).toBe(true)
    const ticksBefore = ticks((await terminal('a1')).text).length
    const historyBefore = await statusHistory('a1')

    await switchTo('b')
    await delay(1000)
    await switchTo('c')
    await delay(1000)
    await switchTo('a')
    await delay(600)

    const text = (await terminal('a1')).text
    const seen = ticks(text)
    // Ticks printed while a1 was hidden are in its buffer, with no gap.
    expect(seen).toEqual(seen.map((_, i) => i + 1))
    expect(seen.length).toBeGreaterThan(ticksBefore + 8)
    expect(text.match(/FAKE_AGENT_PID=/g)).toHaveLength(1)
    expect(isProcessAlive(agentPid)).toBe(true)
    expect(await statusOf('a1')).toBe('running')
    expect(await statusHistory('a1')).toEqual(historyBefore)
    // Initial plain shell + Launch; switching never respawned anything.
    expect(await spawnsOf('a1')).toBe(2)
  })

  it('preserves scrollback, cursor and colors exactly', async () => {
    const command =
      "for i in $(seq 1 300); do printf '\\033[3%dmcolor line %d\\033[0m\\n' $((i % 7 + 1)) $i; done; " +
      "printf '\\033[1;35mDONE\\055MARK\\033[0m\\n'\r"
    await cdp.eval(`window.electronAPI.writePty('a2', ${JSON.stringify(command)})`)
    await waitForText('a2', 'DONE-MARK')
    await delay(800) // let the prompt settle

    const before = await terminal('a2')
    expect(before.bufferLength).toBeGreaterThan(300)
    expect(before.serialized).toContain('\x1b[37mcolor line 300')
    expect(before.serialized).toContain('DONE-MARK')

    await switchTo('b')
    await switchTo('c')
    await switchTo('a')
    await delay(300)

    const after = await terminal('a2')
    expect(after.serialized).toBe(before.serialized)
    expect([after.cursorX, after.cursorY, after.bufferLength, after.cols, after.rows]).toEqual([
      before.cursorX,
      before.cursorY,
      before.bufferLength,
      before.cols,
      before.rows
    ])
  })

  it('keeps WebGL contexts within budget across 3x3 panels and many switches', async () => {
    for (let round = 0; round < 10; round++) {
      for (const key of ['b', 'c', 'a']) {
        await switchTo(key)
        expect(await webglCount()).toBeLessThanOrEqual(3)
        expect(await liveContexts()).toBeLessThanOrEqual(3)
      }
    }
    await delay(1000)

    const list = await sessions()
    expect(list.map((s) => s.id).sort()).toEqual(SEEDED_IDS)
    expect(list.filter((s) => s.webgl).map((s) => s.id).sort()).toEqual(['a1', 'a2', 'a3'])
    // Every context of a hidden panel was really released, not just dropped.
    expect(await liveContexts()).toBe(3)
    expect(await cdp.eval<number>('window.__gl.length')).toBeGreaterThan(3 * 2 * 10)
    // Nothing was ever respawned: one spawn per panel, plus a1's Launch.
    expect(Object.fromEntries(list.map((s) => [s.id, s.spawns]))).toEqual(
      Object.fromEntries(SEEDED_IDS.map((id) => [id, id === 'a1' ? 2 : 1]))
    )
    const webglWarnings = cdp.consoleLines.filter((l) =>
      /too many active webgl contexts|webglcontextlost|context lost/i.test(l)
    )
    expect(webglWarnings).toEqual([])
    expect(isProcessAlive(agentPid)).toBe(true)
  })

  it('maximize releases hidden renderers and restore brings them back', async () => {
    await cdp.eval(`document.querySelector('[data-panel-id="a2"] button[title^="Maximize"]').click()`)
    await cdp.waitFor('window.__myterm.webglCount() === 1', 'one renderer while maximized')
    expect(await liveContexts()).toBe(1)

    await cdp.eval(`document.querySelector('[data-panel-id="a2"] button[title^="Restore"]').click()`)
    await cdp.waitFor('window.__myterm.webglCount() === 3', 'three renderers after restore')
    expect(await liveContexts()).toBe(3)
    expect(await spawnsOf('a2')).toBe(1)
    expect(isProcessAlive(agentPid)).toBe(true)
    expect(await statusOf('a1')).toBe('running')
  })

  it('auto-launches an agent from the New Panel dialog', async () => {
    await switchTo('c')
    await cdp.eval(`document.querySelector('button[title="Add panel (Cmd+N)"]').click()`)
    await cdp.waitFor(`!!document.querySelector('.modal-dialog form')`, 'New Panel dialog')
    await cdp.eval(`document.querySelector('.modal-dialog form').requestSubmit()`)

    const newId = await cdp.waitFor<string>(
      `window.__myterm.sessions().map((s) => s.id).find((id) => !${JSON.stringify(SEEDED_IDS)}.includes(id))`,
      'new panel session'
    )
    await waitForText(newId, 'FAKE_AGENT_TICK 2')
    expect(await statusOf(newId)).toBe('running')
    expect(await spawnsOf(newId)).toBe(1)
  })

  it('saves every terminal’s scrollback when the window closes', async () => {
    await cdp.eval('setTimeout(() => window.close(), 0)').catch(() => undefined)

    const scrollbackDir = path.join(userDataDir, 'scrollbacks')
    const read = (id: string) => {
      const file = path.join(scrollbackDir, `${id}.log`)
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    }
    const started = Date.now()
    while (!read('a2').includes('DONE-MARK') && Date.now() - started < 8000) await delay(100)

    expect(read('a2')).toContain('DONE-MARK')
    expect(read('a1')).toContain('FAKE_AGENT_TICK')
    for (const id of SEEDED_IDS) expect(fs.existsSync(path.join(scrollbackDir, `${id}.log`))).toBe(true)
  })
})
