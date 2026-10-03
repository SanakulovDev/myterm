import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PtyManager } from '../src/main/pty-manager'
import { PtyLaunchEvent, launchEventStatus } from '../src/main/launch-marker'
import { LaunchSpec, PanelStatus } from '../src/shared/types'

// Integration tests: a real PTY, a real login+interactive shell, a fake agent.
// HOME/ZDOTDIR point at a temp dir so the user's own rc files do not run; the
// temp rc files add a PATH entry to prove rc-defined PATH reaches the launch.

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agent.sh')
const MISSING = 'myterm-missing-agent-xyz'
const TIMEOUT = 20000

let root: string
let home: string
let projectDir: string
let agentPath: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-launch-')))
  home = path.join(root, 'home')
  projectDir = path.join(root, "proj with space's dir")
  const rcBin = path.join(home, 'rc bin')
  fs.mkdirSync(rcBin, { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })

  agentPath = path.join(projectDir, "fake agent's.sh")
  fs.copyFileSync(FIXTURE, agentPath)
  fs.chmodSync(agentPath, 0o755)
  fs.copyFileSync(FIXTURE, path.join(rcBin, 'rc-only-agent'))
  fs.chmodSync(path.join(rcBin, 'rc-only-agent'), 0o755)

  // A file the glob `a*b` would match if globbing were not disabled.
  fs.writeFileSync(path.join(projectDir, 'aXb'), '')

  const pathLine = `export PATH="$HOME/rc bin:$PATH"\n`
  fs.writeFileSync(path.join(home, '.zshrc'), pathLine)
  fs.writeFileSync(path.join(home, '.bashrc'), pathLine)
  fs.writeFileSync(path.join(home, '.bash_profile'), '. "$HOME/.bashrc"\n')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

interface PanelRun {
  id: string
  output: () => string
  events: PtyLaunchEvent[]
  statuses: PanelStatus[]
  write: (data: string) => void
  waitFor: (predicate: () => boolean, label: string) => Promise<void>
  waitForOutput: (text: string) => Promise<void>
}

const manager = new PtyManager()
let panelCounter = 0

afterEach(() => {
  manager.killAll()
})

function startPanel(shell: string, launch: LaunchSpec | undefined, cwd = projectDir): PanelRun {
  const id = `launch-test-${++panelCounter}`
  let output = ''
  const events: PtyLaunchEvent[] = []
  const statuses: PanelStatus[] = []

  const ok = manager.spawn(
    {
      id,
      cwd,
      shell,
      launch,
      cols: 120,
      rows: 30,
      env: { HOME: home, ZDOTDIR: home, BASH_SILENCE_DEPRECATION_WARNING: '1' }
    },
    (data) => {
      output += data
    },
    () => {},
    (event) => {
      events.push(event)
      statuses.push(launchEventStatus(event).status)
    }
  )
  expect(ok).toBe(true)

  const waitFor = (predicate: () => boolean, label: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer)
          resolve()
        } else if (Date.now() - started > TIMEOUT - 2000) {
          clearInterval(timer)
          reject(new Error(`Timed out waiting for ${label}. Output:\n${JSON.stringify(output)}`))
        }
      }, 25)
    })

  return {
    id,
    output: () => output,
    events,
    statuses,
    write: (data) => manager.write(id, data),
    waitFor,
    waitForOutput: (text) => waitFor(() => output.includes(text), JSON.stringify(text))
  }
}

const markerEvent = (run: PanelRun): PtyLaunchEvent | undefined =>
  run.events.find((e) => e.type === 'exit' || e.type === 'missing')

/** After the marker, the fallback interactive shell must accept commands. */
async function expectShellAlive(run: PanelRun): Promise<void> {
  run.write('echo __ALIVE__$((40+2))\r')
  await run.waitForOutput('__ALIVE__42')
}

function expectNoMarkerLeak(run: PanelRun): void {
  expect(run.output()).not.toContain('\x1b]6973')
}

function expectOnlyRunningThenIdle(run: PanelRun): void {
  expect(run.statuses).toEqual(['running', 'idle'])
  expect(run.statuses).not.toContain('done')
  expect(run.statuses).not.toContain('waiting')
}

describe.each(['/bin/zsh', '/bin/bash'])('agent auto-launch in %s', (shell) => {
  it(
    'runs the agent (exit 0) in a folder with spaces and an apostrophe, then keeps the shell',
    async () => {
      const run = startPanel(shell, { command: agentPath, args: '--exit 0 --tag a*b' })

      await run.waitFor(() => !!markerEvent(run), 'launch marker')
      expect(markerEvent(run)).toEqual({ type: 'exit', code: 0, command: agentPath })
      expect(run.events[0]).toEqual({ type: 'started', command: agentPath })

      // Output is batched (12ms), so it can trail the marker event slightly.
      await run.waitForOutput('FAKE_AGENT_NONCE=')
      const out = run.output()
      expect(out).toContain('FAKE_AGENT_ARGC=4')
      expect(out).toContain('FAKE_AGENT_ARG=[a*b]')
      expect(out).not.toContain('FAKE_AGENT_ARG=[aXb]')
      expect(out).toContain(`FAKE_AGENT_CWD=[${projectDir}]`)
      expect(out).toContain('FAKE_AGENT_NONCE=[unset]')

      await expectShellAlive(run)
      expectNoMarkerLeak(run)
      expectOnlyRunningThenIdle(run)
    },
    TIMEOUT
  )

  it(
    'reports a non-zero agent exit code and keeps the shell',
    async () => {
      const run = startPanel(shell, { command: agentPath, args: '--exit 1' })

      await run.waitFor(() => !!markerEvent(run), 'launch marker')
      expect(markerEvent(run)).toEqual({ type: 'exit', code: 1, command: agentPath })
      expect(launchEventStatus(markerEvent(run)!)).toEqual({
        status: 'idle',
        detail: 'Agent exited (code 1)'
      })

      await expectShellAlive(run)
      expectNoMarkerLeak(run)
      expectOnlyRunningThenIdle(run)
    },
    TIMEOUT
  )

  it(
    'prints a banner for a missing command and keeps the shell',
    async () => {
      const run = startPanel(shell, { command: MISSING })

      await run.waitFor(() => !!markerEvent(run), 'missing marker')
      expect(markerEvent(run)).toEqual({ type: 'missing', command: MISSING })
      await run.waitForOutput(`Command "${MISSING}" not found in PATH.`)
      expect(launchEventStatus(markerEvent(run)!).status).toBe('idle')

      await expectShellAlive(run)
      expectNoMarkerLeak(run)
      expectOnlyRunningThenIdle(run)
    },
    TIMEOUT
  )

  it(
    'Ctrl+C stops the agent (130) and the fallback shell still appears',
    async () => {
      const run = startPanel(shell, { command: agentPath, args: '--wait' })

      await run.waitForOutput('FAKE_AGENT_WAITING')
      run.write('\x03')

      await run.waitFor(() => !!markerEvent(run), 'launch marker after Ctrl+C')
      expect(markerEvent(run)).toEqual({ type: 'exit', code: 130, command: agentPath })
      expect(launchEventStatus(markerEvent(run)!).detail).toBe('Agent interrupted')

      await expectShellAlive(run)
      expectNoMarkerLeak(run)
      expectOnlyRunningThenIdle(run)
    },
    TIMEOUT
  )

  it(
    'finds commands on a PATH set by the interactive rc files',
    async () => {
      const run = startPanel(shell, { command: 'rc-only-agent' })

      await run.waitFor(() => !!markerEvent(run), 'launch marker')
      expect(markerEvent(run)).toEqual({ type: 'exit', code: 0, command: 'rc-only-agent' })
      await expectShellAlive(run)
    },
    TIMEOUT
  )

  it(
    'starts a plain shell without a marker when there is nothing to launch',
    async () => {
      const run = startPanel(shell, undefined)
      await expectShellAlive(run)
      expect(run.events).toEqual([])
    },
    TIMEOUT
  )
})

describe('agent auto-launch with a non-POSIX shell', () => {
  it(
    'starts a plain login shell with a banner and reports idle',
    async () => {
      // isPosixShell() goes by basename, so a symlink named "fish" stands in for fish.
      const fakeFish = path.join(root, 'fish')
      fs.symlinkSync('/bin/sh', fakeFish)

      const run = startPanel(fakeFish, { command: agentPath })
      expect(run.events).toEqual([{ type: 'unsupported-shell', shell: fakeFish }])
      expect(run.statuses).toEqual(['idle'])

      await expectShellAlive(run)
      expect(run.output()).toContain('Auto-launch needs a POSIX shell')
      expect(run.output()).not.toContain('FAKE_AGENT_ARGC')
    },
    TIMEOUT
  )
})
