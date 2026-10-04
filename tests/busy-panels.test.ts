import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PtyManager, parseForegroundGroups } from '../src/main/pty-manager'
import type { PtyLaunchEvent } from '../src/main/launch-marker'
import type { LaunchSpec } from '../src/shared/types'

// Which panels make Cmd+Q ask first: a launched agent until its exit marker,
// or any command started by hand. An idle shell must never count. Real PTYs;
// HOME/ZDOTDIR point at an empty temp dir so no user rc file runs.

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agent.sh')
const TIMEOUT = 20000

let home: string

beforeAll(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-busy-')))
})

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

const manager = new PtyManager()
let counter = 0

afterEach(() => {
  manager.killAll()
})

function start(shell: string, launch?: LaunchSpec, target = manager) {
  const id = `busy-${++counter}`
  let output = ''
  const events: PtyLaunchEvent[] = []
  const ok = target.spawn(
    {
      id,
      cwd: home,
      shell,
      launch,
      cols: 100,
      rows: 30,
      env: { HOME: home, ZDOTDIR: home, BASH_SILENCE_DEPRECATION_WARNING: '1' }
    },
    (data) => {
      output += data
    },
    () => {},
    (event) => events.push(event)
  )
  expect(ok).toBe(true)
  return {
    id,
    events,
    output: () => output,
    write: (data: string) => target.write(id, data)
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > TIMEOUT - 3000) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

const busyIds = (target = manager): string[] => target.busyPanels().map((b) => b.id)

/** Wait until the shell answers, i.e. sits at its prompt. */
async function shellReady(run: ReturnType<typeof start>, tag: string): Promise<void> {
  run.write(`echo __READY_${tag}__$((1+1))\r`)
  await waitFor(() => run.output().includes(`__READY_${tag}__2`), `${tag} prompt`)
}

/** An idle shell is never busy, sampled repeatedly while it sits at the prompt. */
async function expectIdleFor(ms: number, target = manager): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    expect(busyIds(target)).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('parseForegroundGroups', () => {
  it('reads pid/tpgid pairs and skips anything else', () => {
    const groups = parseForegroundGroups('  123   456\n 7 -1\nps: junk\n\n 9 9 \n')
    expect([...groups]).toEqual([
      [123, 456],
      [7, -1],
      [9, 9]
    ])
  })
})

describe.each(['/bin/zsh', '/bin/bash', '/bin/sh'])('busy panels in %s', (shell) => {
  it(
    'an idle shell is not busy; a command started by hand is, until it ends',
    async () => {
      const run = start(shell)
      await shellReady(run, 'a')
      await expectIdleFor(500)

      run.write('sleep 30\r')
      await waitFor(() => busyIds().includes(run.id), 'sleep to be busy')
      expect(manager.busyPanels()).toEqual([{ id: run.id, process: 'sleep' }])

      run.write('\x03')
      await waitFor(() => busyIds().length === 0, 'shell idle after Ctrl+C')
      await shellReady(run, 'b')
      await expectIdleFor(300)
    },
    TIMEOUT
  )

  it(
    'a script started by hand counts even when its interpreter has the shell’s name',
    async () => {
      const run = start(shell)
      await shellReady(run, 'a')
      // /bin/sh runs as "bash" on macOS; a name check would miss this.
      run.write(`sh '${FIXTURE}' --wait\r`)
      await waitFor(() => run.output().includes('FAKE_AGENT_WAITING'), 'script running')
      expect(busyIds()).toEqual([run.id])
      run.write('\x03')
      await waitFor(() => busyIds().length === 0, 'shell idle after Ctrl+C')
    },
    TIMEOUT
  )
})

describe.each(['/bin/zsh', '/bin/bash'])('launched agents in %s', (shell) => {
  it(
    'a launched agent is busy until its exit marker; the fallback shell is not',
    async () => {
      const run = start(shell, { command: FIXTURE, args: '--wait' })
      // Busy from the start, before the agent even printed anything.
      expect(manager.busyPanels()).toEqual([{ id: run.id, process: FIXTURE }])
      await waitFor(() => run.output().includes('FAKE_AGENT_WAITING'), 'agent running')
      expect(manager.busyPanels()).toEqual([{ id: run.id, process: FIXTURE }])

      run.write('\x03')
      await waitFor(() => run.events.some((e) => e.type === 'exit'), 'exit marker')
      await shellReady(run, 'after')
      await expectIdleFor(500)
    },
    TIMEOUT
  )
})

describe('when the foreground groups cannot be read', () => {
  it('only launched agents count, and nothing throws', async () => {
    const failing = new PtyManager(undefined, () => {
      throw new Error('ps failed')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const idle = start('/bin/zsh', undefined, failing)
      const agent = start('/bin/zsh', { command: FIXTURE, args: '--wait' }, failing)
      await shellReady(idle, 'x')
      idle.write('sleep 30\r')
      expect(failing.busyPanels()).toEqual([{ id: agent.id, process: FIXTURE }])
      expect(warn).toHaveBeenCalled()
    } finally {
      failing.killAll()
      warn.mockRestore()
    }
  })

  it('a shell missing from the result counts as idle', async () => {
    const empty = new PtyManager(undefined, () => new Map())
    try {
      const run = start('/bin/zsh', undefined, empty)
      await shellReady(run, 'y')
      run.write('sleep 30\r')
      await expectIdleFor(300, empty)
    } finally {
      empty.killAll()
    }
  })
})
