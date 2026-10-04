import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  AgentDetector,
  detectAgents,
  detectCommands,
  detectionShell,
  isCheckableCommand,
  parseDetectOutput
} from '../src/main/agent-detect'
import { AGENTS } from '../src/shared/agents'

// Detection runs a real login+interactive shell. HOME/ZDOTDIR point at a temp
// dir whose rc files print a banner (with fake result lines), define a
// function and add a PATH entry, the way a real user's rc files do.

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-agent.sh')
const NONCE = '0123456789abcdef0123456789abcdef'
const TIMEOUT = 20000

let root: string
let home: string
let rcBin: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-detect-')))
  home = path.join(root, 'home')
  rcBin = path.join(home, 'rc bin')
  fs.mkdirSync(rcBin, { recursive: true })

  fs.copyFileSync(FIXTURE, path.join(rcBin, 'myterm-fake-found'))
  fs.chmodSync(path.join(rcBin, 'myterm-fake-found'), 0o755)
  fs.writeFileSync(path.join(rcBin, 'myterm-fake-noexec'), '#!/bin/sh\n')
  fs.chmodSync(path.join(rcBin, 'myterm-fake-noexec'), 0o644)

  // A banner that imitates the result format must not count as a result.
  const rc =
    `printf 'WELCOME\\n0\\tfound\\t/evil\\n'\n` +
    `export PATH="$HOME/rc bin:$PATH"\n` +
    `myterm_fake_fn() { :; }\n`
  fs.writeFileSync(path.join(home, '.zshrc'), rc)
  fs.writeFileSync(path.join(home, '.bashrc'), rc)
  fs.writeFileSync(path.join(home, '.bash_profile'), '. "$HOME/.bashrc"\n')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function env(): Record<string, string> {
  return { HOME: home, ZDOTDIR: home, BASH_SILENCE_DEPRECATION_WARNING: '1' }
}

describe('parseDetectOutput', () => {
  it('reads only the lines between the nonce markers', () => {
    const stdout =
      `banner\n0\tfound\t/evil\n` +
      `\n${NONCE}:begin\n0\tfound\t/usr/bin/a b\n1\tshell\t\n2\tmissing\t\n${NONCE}:end\n`
    expect(parseDetectOutput(stdout, NONCE, 3)).toEqual([
      { presence: 'found', path: '/usr/bin/a b' },
      { presence: 'shell' },
      { presence: 'missing' }
    ])
  })

  it('needs both markers', () => {
    expect(parseDetectOutput(`${NONCE}:begin\n0\tmissing\t\n`, NONCE, 1)).toBeNull()
    expect(parseDetectOutput(`0\tmissing\t\n${NONCE}:end\n`, NONCE, 1)).toBeNull()
  })

  it('leaves malformed and out-of-range lines unknown', () => {
    const stdout = `${NONCE}:begin\n9\tfound\t/x\n-1\tmissing\t\n0\tweird\t\nx\tfound\t/y\n${NONCE}:end\n`
    expect(parseDetectOutput(stdout, NONCE, 2)).toEqual([
      { presence: 'unknown' },
      { presence: 'unknown' }
    ])
  })
})

describe('isCheckableCommand', () => {
  it('refuses empty, padded, multi-line and control-character commands', () => {
    expect(isCheckableCommand('claude')).toBe(true)
    expect(isCheckableCommand('/opt/my tools/claude')).toBe(true)
    expect(isCheckableCommand('')).toBe(false)
    expect(isCheckableCommand(' claude')).toBe(false)
    expect(isCheckableCommand('a\nb')).toBe(false)
    expect(isCheckableCommand('a\tb')).toBe(false)
    expect(isCheckableCommand('x'.repeat(5000))).toBe(false)
  })
})

describe('detectionShell', () => {
  it('uses a POSIX login shell as is and falls back for others', () => {
    expect(detectionShell('/bin/bash')).toBe('/bin/bash')
    expect(['/bin/zsh', '/bin/sh']).toContain(detectionShell('/opt/homebrew/bin/fish'))
  })
})

for (const shell of ['/bin/zsh', '/bin/bash']) {
  describe(`detectCommands in ${shell}`, () => {
    it(
      'finds executables in the rc PATH, functions, and missing names',
      async () => {
        const result = await detectCommands(
          [
            'myterm-fake-found',
            'myterm_fake_fn',
            'myterm-fake-noexec',
            'myterm-missing-xyz',
            '/bin/sh',
            '/nonexistent/agent',
            "it's $(touch pwned)"
          ],
          { shell, env: env(), cwd: root }
        )
        expect(result.error).toBeUndefined()
        expect(result.shell).toBe(shell)
        expect(result.results).toEqual([
          { presence: 'found', path: path.join(rcBin, 'myterm-fake-found') },
          { presence: 'shell' },
          { presence: 'missing' },
          { presence: 'missing' },
          { presence: 'found', path: '/bin/sh' },
          { presence: 'missing' },
          { presence: 'missing' }
        ])
        expect(fs.existsSync(path.join(root, 'pwned'))).toBe(false)
      },
      TIMEOUT
    )
  })
}

describe('detectCommands failures', () => {
  it(
    'reports every command unknown when the shell hangs',
    async () => {
      const slowHome = path.join(root, 'slow')
      fs.mkdirSync(slowHome, { recursive: true })
      fs.writeFileSync(path.join(slowHome, '.zshrc'), 'sleep 30\n')
      const started = Date.now()
      const result = await detectCommands(['ls'], {
        shell: '/bin/zsh',
        env: { HOME: slowHome, ZDOTDIR: slowHome },
        timeoutMs: 1000
      })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(result.results).toEqual([{ presence: 'unknown' }])
      expect(result.error).toMatch(/did not answer/)
    },
    TIMEOUT
  )

  it(
    'reports every command unknown when an rc file exits the shell',
    async () => {
      const exitHome = path.join(root, 'exit')
      fs.mkdirSync(exitHome, { recursive: true })
      fs.writeFileSync(path.join(exitHome, '.zshrc'), 'exit 3\n')
      const result = await detectCommands(['ls', 'cat'], {
        shell: '/bin/zsh',
        env: { HOME: exitHome, ZDOTDIR: exitHome }
      })
      expect(result.results).toEqual([{ presence: 'unknown' }, { presence: 'unknown' }])
      expect(result.error).toMatch(/code 3/)
    },
    TIMEOUT
  )

  it('refuses a command it cannot pass safely, without running a shell', async () => {
    const result = await detectCommands(['ok', 'bad\nline'], { shell: '/bin/zsh' })
    expect(result.results).toEqual([{ presence: 'unknown' }, { presence: 'unknown' }])
    expect(result.error).toBeDefined()
  })
})

describe('detectAgents', () => {
  it(
    'checks every known agent with its saved command',
    async () => {
      const result = await detectAgents(
        { claude: { command: 'myterm-fake-found', args: '' }, gemini: { command: '/bin/sh' } },
        { shell: '/bin/zsh', env: env() }
      )
      expect(result.agents.map((a) => a.id)).toEqual(AGENTS.map((a) => a.id))
      const byId = new Map(result.agents.map((a) => [a.id, a]))
      expect(byId.get('claude')).toEqual({
        id: 'claude',
        command: 'myterm-fake-found',
        presence: 'found',
        path: path.join(rcBin, 'myterm-fake-found')
      })
      expect(byId.get('gemini')?.presence).toBe('found')
      for (const entry of result.agents) {
        expect(['found', 'shell', 'missing']).toContain(entry.presence)
      }
    },
    TIMEOUT
  )
})

describe('AgentDetector', () => {
  it(
    'keeps a result until the commands change or a refresh is asked',
    async () => {
      let settings = { claude: { command: 'myterm-fake-found' } }
      const detector = new AgentDetector(() => settings, { shell: '/bin/zsh', env: env() })
      const first = detector.detect()
      expect(detector.detect()).toBe(first)
      await first
      expect(detector.detect()).toBe(first)
      expect(detector.detect(true)).not.toBe(first)

      const second = detector.detect()
      settings = { claude: { command: 'myterm-missing-xyz' } }
      const third = detector.detect()
      expect(third).not.toBe(second)
      const claude = (await third).agents.find((a) => a.id === 'claude')
      expect(claude?.presence).toBe('missing')
    },
    TIMEOUT
  )

  it(
    'does not keep a failed run',
    async () => {
      const exitHome = path.join(root, 'exit2')
      fs.mkdirSync(exitHome, { recursive: true })
      fs.writeFileSync(path.join(exitHome, '.zshrc'), 'exit 1\n')
      const detector = new AgentDetector(() => undefined, {
        shell: '/bin/zsh',
        env: { HOME: exitHome, ZDOTDIR: exitHome }
      })
      const first = detector.detect()
      expect((await first).error).toBeDefined()
      expect(detector.detect()).not.toBe(first)
    },
    TIMEOUT
  )
})
