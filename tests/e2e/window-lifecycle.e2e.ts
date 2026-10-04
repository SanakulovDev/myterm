import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, RunningApp, Cdp, delay, isProcessAlive } from './harness'

// The window's lifecycle on macOS: the close button only hides the window,
// a hidden window keeps everything running at full speed, the Dock shows the
// same window again, and quitting asks first only while something runs.
//
// One workspace: "agent" (a restored agent panel whose agent is the fake
// agent in --tick mode) and two shell panels. Three app runs share one
// user data dir, so later runs see what earlier runs saved.

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-agent.sh')
const M = 'globalThis.__mytermMain'
// The window stays hidden this long; the autosave interval is 30 s.
const HIDDEN_MS = 62_000

let root: string
let userDataDir: string
let zdotdir: string
let agentPath: string
let app: RunningApp
let cdp: Cdp

interface SessionInfo {
  id: string
  spawns: number
}

const mainEval = <T = unknown>(expression: string): Promise<T> => app.main.eval<T>(expression)
const terminalText = async (id: string): Promise<string> =>
  (await cdp.eval<{ text: string } | null>(`window.__myterm.terminal(${JSON.stringify(id)})`))?.text ?? ''
const sessions = () => cdp.eval<SessionInfo[]>('window.__myterm.sessions()')
const spawnCounts = async () => Object.fromEntries((await sessions()).map((s) => [s.id, s.spawns]))
const statusHistory = (id: string) =>
  cdp.eval<string[]>(`window.__sth.filter((e) => e[0] === ${JSON.stringify(id)}).map((e) => e[1])`)
const busyPanels = () => mainEval<string>(`JSON.stringify(${M}.ptyManager.busyPanels())`).then(JSON.parse)
const prompts = () => mainEval<Array<Record<string, unknown>>>('globalThis.__prompts')
const writePty = (id: string, data: string) =>
  cdp.eval(`window.electronAPI.writePty(${JSON.stringify(id)}, ${JSON.stringify(data)})`)

const scrollbackDir = (): string => path.join(userDataDir, 'scrollbacks')
const logFile = (id: string): string => path.join(scrollbackDir(), `${id}.log`)
const readLog = (id: string): string => (fs.existsSync(logFile(id)) ? fs.readFileSync(logFile(id), 'utf8') : '')
const mode = (file: string): number => fs.statSync(file).mode & 0o777

function ticks(text: string): number[] {
  return [...text.matchAll(/FAKE_AGENT_TICK (\d+)/g)].map((m) => Number(m[1]))
}
const lastTick = (text: string): number => Math.max(0, ...ticks(text))

function waitForText(id: string, text: string, timeoutMs = 15000): Promise<unknown> {
  return cdp.waitFor(
    `window.__myterm.terminal(${JSON.stringify(id)})?.text.includes(${JSON.stringify(text)})`,
    `${JSON.stringify(text)} in ${id}`,
    timeoutMs
  )
}

async function until(predicate: () => boolean, label: string, timeoutMs = 10000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
    await delay(100)
  }
}

/** Resolves with the exit, or rejects if the app is still running after `ms`. */
async function exitWithin(ms: number) {
  const timeout = delay(ms).then(() => {
    throw new Error(`App still running after ${ms} ms. Output:\n${app.output()}`)
  })
  return Promise.race([app.exited, timeout])
}

// Ipc listeners and handlers, and the tracker's listeners: a second
// registration would change these.
const LISTENERS = `JSON.stringify({
  ipc: ${M}.ipcMain.eventNames().map((n) => [String(n), ${M}.ipcMain.listenerCount(n)]),
  handlers: ${M}.ipcMain._invokeHandlers?.size ?? null,
  status: ${M}.agentTracker.listenerCount('status-change'),
  unread: ${M}.agentTracker.listenerCount('unread-change')
})`

// Replaces the quit prompt. It records each prompt, prints a line the test
// can read even after the app exited, and answers like the real one: with
// __promptAnswer, or later through __answerPrompt while __promptHold is
// set; aborting it answers Cancel.
const DIALOG_STUB = `(() => {
  globalThis.__prompts = []
  globalThis.__promptAnswer = 1
  globalThis.__promptHold = false
  ${M}.dialog.showMessageBox = (a, b) => {
    const win = b ? a : null
    const options = b ?? a
    const entry = {
      message: options.message,
      detail: options.detail,
      parent: !!win,
      parentVisible: !!win && win.isVisible(),
      aborted: false
    }
    globalThis.__prompts.push(entry)
    console.log('E2E_PROMPT_SHOWN ' + globalThis.__prompts.length)
    return new Promise((resolve) => {
      const respond = (response) => resolve({ response, checkboxChecked: false })
      options.signal?.addEventListener('abort', () => {
        entry.aborted = true
        console.log('E2E_PROMPT_ABORTED')
        respond(options.cancelId ?? 1)
      })
      if (globalThis.__promptHold) globalThis.__answerPrompt = respond
      else setTimeout(() => respond(globalThis.__promptAnswer), 50)
    })
  }
})()`

// Agent status as the renderer receives it, and the longest gap between two
// runs of a 100 ms timer (a throttled hidden page runs timers about once a
// second).
const RENDERER_RECORDERS = `(() => {
  window.__st = {}
  window.__sth = []
  window.electronAPI.onAgentStatus((id, status) => {
    window.__st[id] = status
    window.__sth.push([id, status])
  })
  window.__gap = { last: performance.now(), max: 0 }
  setInterval(() => {
    const now = performance.now()
    window.__gap.max = Math.max(window.__gap.max, now - window.__gap.last)
    window.__gap.last = now
  }, 100)
})()`
const resetGap = () => cdp.eval('window.__gap.max = 0; window.__gap.last = performance.now()')

async function startApp(): Promise<void> {
  app = await launchApp(userDataDir, { ZDOTDIR: zdotdir })
  cdp = app.cdp
  await cdp.waitFor('window.__myterm && window.__myterm.sessions().length >= 2', 'restored panels')
  await mainEval(DIALOG_STUB)
  await cdp.eval(RENDERER_RECORDERS)
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-e2e-life-')))
  userDataDir = path.join(root, 'user-data')
  const projectDir = path.join(root, 'project')
  zdotdir = path.join(root, 'zdotdir')
  fs.mkdirSync(userDataDir)
  fs.mkdirSync(projectDir)
  fs.mkdirSync(zdotdir)
  // An rc file must exist, or zsh opens its new-user menu.
  fs.writeFileSync(path.join(zdotdir, '.zshrc'), "PS1='e2e%# '\n")

  agentPath = path.join(root, 'fake-agent.sh')
  fs.copyFileSync(FIXTURE, agentPath)
  fs.chmodSync(agentPath, 0o755)

  const panels = [
    { id: 'agent', title: 'Agent', agent: 'claude', agentCommand: agentPath, agentArgs: '--tick' },
    { id: 'shell1', title: 'Shell 1', agent: 'none' },
    { id: 'shell2', title: 'Shell 2', agent: 'none' }
  ].map((p) => ({ ...p, cwd: projectDir, shell: '/bin/zsh' }))
  const state = {
    schemaVersion: 2,
    activeWorkspaceId: 'ws',
    lastUsedFolder: projectDir,
    agentSettings: { claude: { command: agentPath, args: '--tick' }, codex: { command: 'codex' } },
    window: { width: 1300, height: 800 },
    workspaces: [
      { id: 'ws', name: 'Life', layout: { rows: 1, cols: 3 }, panels, panelOrder: panels.map((p) => p.id) }
    ]
  }
  fs.writeFileSync(path.join(userDataDir, 'workspace-state.json'), JSON.stringify(state, null, 2))

  await startApp()
})

afterAll(async () => {
  await app?.stop()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('first run: hide, show and quit', () => {
  let agentPid = 0
  let manualPid = 0

  it('restores the agent panel as a plain shell', async () => {
    await waitForText('agent', 'e2e%')
    expect(await terminalText('agent')).not.toContain('FAKE_AGENT')
    expect(await spawnCounts()).toEqual({ agent: 1, shell1: 1, shell2: 1 })
  })

  it(
    'the close button hides the window; output, timers and autosave keep full speed for a minute',
    async () => {
      await cdp.eval(`document.querySelector('[data-panel-id="agent"] button[title^="Launch"]').click()`)
      await waitForText('agent', 'FAKE_AGENT_TICK 3')
      agentPid = Number(/FAKE_AGENT_PID=(\d+)/.exec(await terminalText('agent'))![1])
      const webContentsId = await mainEval<number>(`${M}.window().webContents.id`)
      const listeners = await mainEval<string>(LISTENERS)
      const spawns = await spawnCounts()
      const history = await statusHistory('agent')
      expect(history.at(-1)).toBe('running')

      // The red button: BrowserWindow.close() runs the same close handler.
      await mainEval(`${M}.window().close()`)
      await app.main.waitFor(`!${M}.window().isVisible()`, 'window hidden')
      expect(await mainEval(`${M}.BrowserWindow.getAllWindows().length`)).toBe(1)

      // Hiding saved the output right away.
      await until(() => lastTick(readLog('agent')) > 0, 'output saved on hide')
      const tickAtHide = lastTick(await terminalText('agent'))
      await delay(1000)
      await resetGap()
      await delay(HIDDEN_MS - 1000)

      // Still hidden. The 30 s autosave wrote newer output meanwhile, and
      // the page's timers were never throttled.
      // (Without background throttling the page also stays "visible" to
      // the Page Visibility API; the control test below hides it for real.)
      expect(await mainEval(`${M}.window().isVisible()`)).toBe(false)
      expect(lastTick(readLog('agent'))).toBeGreaterThan(tickAtHide + 50)
      expect(await cdp.eval<number>('window.__gap.max')).toBeLessThan(800)

      // A Dock click shows the same window and renderer.
      await mainEval(`${M}.app.emit('activate')`)
      await app.main.waitFor(`${M}.window().isVisible()`, 'window shown')
      expect(await mainEval(`${M}.window().webContents.id`)).toBe(webContentsId)
      expect(await mainEval(`${M}.BrowserWindow.getAllWindows().length`)).toBe(1)

      // Every tick printed while hidden is in the terminal, in order.
      const seen = ticks(await terminalText('agent'))
      expect(seen).toEqual(seen.map((_, i) => i + 1))
      expect(seen.length).toBeGreaterThan(tickAtHide + 250)
      expect(isProcessAlive(agentPid)).toBe(true)
      expect(await spawnCounts()).toEqual(spawns)
      expect(await statusHistory('agent')).toEqual(history)
      expect(await mainEval<string>(LISTENERS)).toBe(listeners)
      expect(app.output()).not.toMatch(/second handler|registered more than once/i)
    },
    HIDDEN_MS + 60_000
  )

  it('the timer measurement does catch throttling (control)', async () => {
    // A runtime setBackgroundThrottling(true) reaches the page only at some
    // later hides (document.visibilityState does not reliably follow either),
    // so this tries a few hide cycles. One throttled cycle shows the gap
    // measurement above would have caught throttling.
    let throttledGap = 0
    for (let attempt = 0; attempt < 6 && throttledGap <= 900; attempt++) {
      await mainEval(`${M}.window().webContents.setBackgroundThrottling(true)`)
      await mainEval(`${M}.window().hide()`)
      await delay(500)
      await resetGap()
      await delay(3000)
      throttledGap = await cdp.eval<number>('window.__gap.max')
      await mainEval(`${M}.window().webContents.setBackgroundThrottling(false)`)
      await mainEval(`${M}.window().show()`)
      await delay(1000)
    }
    expect(throttledGap).toBeGreaterThan(900)
  })

  it('after hiding and showing, each status change reaches the renderer once', async () => {
    const before = await statusHistory('agent')
    await writePty('agent', '\x03')
    await cdp.waitFor(`window.__st.agent === 'idle'`, 'agent idle')
    await delay(500)
    expect(await statusHistory('agent')).toEqual([...before, 'idle'])
    expect(await busyPanels()).toEqual([])
  })

  it('quit with a launched agent asks first, over the hidden window; Cancel keeps everything', async () => {
    await cdp.eval(`document.querySelector('[data-panel-id="agent"] button[title^="Launch"]').click()`)
    await cdp.waitFor(`window.__st.agent === 'running'`, 'agent running again')
    // The earlier run's output stays above; wait for the second PID line.
    await cdp.waitFor(
      `(window.__myterm.terminal('agent')?.text.match(/FAKE_AGENT_PID=/g) ?? []).length === 2`,
      'relaunched agent'
    )
    const pids = [...(await terminalText('agent')).matchAll(/FAKE_AGENT_PID=(\d+)/g)]
    agentPid = Number(pids[1][1])
    expect(isProcessAlive(agentPid)).toBe(true)

    await mainEval(`${M}.window().close()`)
    await app.main.waitFor(`!${M}.window().isVisible()`, 'window hidden')

    // Cmd+Q and Dock > Quit both call app.quit().
    await mainEval(`${M}.app.quit()`)
    await app.main.waitFor('globalThis.__prompts.length === 1', 'quit prompt')
    const [prompt] = await prompts()
    expect(prompt.message).toBe('A panel is still running a process. Quit anyway?')
    expect(prompt.detail).toContain('• Agent: fake-agent.sh')
    expect(prompt.parent).toBe(true)
    expect(prompt.parentVisible).toBe(true)

    await delay(800)
    expect(app.process.exitCode).toBeNull()
    expect(await mainEval(`${M}.isQuitting()`)).toBe(false)
    expect(await mainEval(`${M}.window().isVisible()`)).toBe(true)
    expect(isProcessAlive(agentPid)).toBe(true)
    expect(await cdp.eval('window.__st.agent')).toBe('running')
  })

  it('commands started by hand in shell panels count; idle shells do not', async () => {
    await writePty('agent', '\x03')
    await cdp.waitFor(`window.__st.agent === 'idle'`, 'agent idle')
    await until(() => !isProcessAlive(agentPid), 'agent stopped')
    expect(await busyPanels()).toEqual([])

    // A hand-started agent in Shell 1, a plain command in Shell 2.
    await writePty('shell1', `'${agentPath}' --tick\r`)
    await waitForText('shell1', 'FAKE_AGENT_TICK 2')
    manualPid = Number(/FAKE_AGENT_PID=(\d+)/.exec(await terminalText('shell1'))![1])
    await writePty('shell2', 'sleep 300\r')
    await app.main.waitFor(`${M}.ptyManager.busyPanels().length === 2`, 'two busy panels')

    await mainEval(`${M}.app.quit()`)
    await app.main.waitFor('globalThis.__prompts.length === 2', 'second quit prompt')
    const prompt = (await prompts())[1]
    expect(prompt.message).toBe('2 panels are still running processes. Quit anyway?')
    expect(prompt.detail).toContain('• Shell 1: ')
    expect(prompt.detail).toContain('• Shell 2: sleep')
    expect(prompt.detail).not.toContain('Agent')

    await delay(800)
    expect(app.process.exitCode).toBeNull()
    expect(isProcessAlive(manualPid)).toBe(true)
  })

  it('a system shutdown quits without asking, closing a prompt that is already open', async () => {
    await mainEval('globalThis.__promptHold = true')
    await mainEval(`${M}.app.quit()`)
    await app.main.waitFor('globalThis.__prompts.length === 3', 'third quit prompt')

    // Logout, restart and shut down arrive as powerMonitor 'shutdown'.
    await mainEval(`${M}.powerMonitor.emit('shutdown')`)
    expect(await exitWithin(15000)).toEqual({ code: 0, signal: null })
    expect(app.output()).toContain('E2E_PROMPT_ABORTED')
    expect(app.output()).not.toContain('E2E_PROMPT_SHOWN 4')

    await until(() => !isProcessAlive(manualPid), 'hand-started agent stopped')
    // Output was saved on the way out.
    expect(readLog('shell2')).toContain('sleep 300')
    expect(lastTick(readLog('shell1'))).toBeGreaterThan(1)
  })
})

describe('second run: restore, files, close a panel, quit while idle', () => {
  beforeAll(startApp)

  it('restores plain shells with their saved output and launches nothing', async () => {
    await waitForText('shell2', 'sleep 300')
    const restoredTicks = lastTick(await terminalText('shell1'))
    expect(restoredTicks).toBeGreaterThan(1)
    await delay(1500)
    expect(lastTick(await terminalText('shell1'))).toBe(restoredTicks)
    expect(await spawnCounts()).toEqual({ agent: 1, shell1: 1, shell2: 1 })
    expect(await busyPanels()).toEqual([])
  })

  it('keeps saved output and state owner-only', () => {
    expect(mode(scrollbackDir())).toBe(0o700)
    const files = fs.readdirSync(scrollbackDir())
    expect(files.sort()).toEqual(['agent.log', 'shell1.log', 'shell2.log'])
    for (const file of files) expect(mode(path.join(scrollbackDir(), file))).toBe(0o600)
    for (const file of fs.readdirSync(userDataDir).filter((f) => f.startsWith('workspace-state'))) {
      expect(mode(path.join(userDataDir, file))).toBe(0o600)
    }
  })

  it('closing a panel deletes its saved output', async () => {
    await cdp.eval(`document.querySelector('[data-panel-id="shell2"] button[title^="Close panel"]').click()`)
    await until(() => !fs.existsSync(logFile('shell2')), 'shell2.log deleted')
    await delay(1000)
    expect(fs.existsSync(logFile('shell2'))).toBe(false)
    expect((await sessions()).map((s) => s.id).sort()).toEqual(['agent', 'shell1'])
  })

  it('quits at once with only idle shells', async () => {
    await mainEval(`${M}.app.quit()`)
    expect(await exitWithin(10000)).toEqual({ code: 0, signal: null })
    expect(app.output()).not.toContain('E2E_PROMPT_SHOWN')
    expect(fs.existsSync(logFile('shell2'))).toBe(false)
  })
})

describe('third run: a signal never waits for the prompt', () => {
  beforeAll(startApp)

  it('SIGTERM with a busy panel quits without asking and saves output', async () => {
    expect((await sessions()).map((s) => s.id).sort()).toEqual(['agent', 'shell1'])
    await waitForText('shell1', 'e2e%')
    await writePty('shell1', 'echo SIGTERM-RUN; sleep 300\r')
    await app.main.waitFor(`${M}.ptyManager.busyPanels().length === 1`, 'busy panel')

    app.process.kill('SIGTERM')
    expect(await exitWithin(10000)).toEqual({ code: 0, signal: null })
    expect(app.output()).not.toContain('E2E_PROMPT_SHOWN')
    expect(readLog('shell1')).toContain('SIGTERM-RUN')
  })
})
