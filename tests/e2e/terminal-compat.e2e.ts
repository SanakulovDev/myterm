import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, RunningApp, Cdp, delay } from './harness'

// A terminal panel behaves like a native macOS terminal (Ghostty, cmux) for
// the programs that run in it: the bundled font and Unicode 11 widths, the
// keys agents expect, Cmd+click links, file drops, and a clean environment
// even when the app itself was started from inside another terminal.
//
// One workspace with one shell panel, "t1".

const M = 'globalThis.__mytermMain'
const PANEL = 't1'
const PANEL_SELECTOR = `[data-panel-id="${PANEL}"]`

// CDP modifier bits.
const ALT = 1
const META = 4
const SHIFT = 8

let root: string
let userDataDir: string
let shimsDir: string
let app: RunningApp
let cdp: Cdp

interface TerminalInfo {
  cols: number
  rows: number
  fontFamily: string
  fontSize: number
  unicodeVersion: string
  cursorX: number
  cursorY: number
  text: string
}

const terminal = () => cdp.eval<TerminalInfo>(`window.__myterm.terminal(${JSON.stringify(PANEL)})`)
const writePty = (data: string) =>
  cdp.eval(`window.electronAPI.writePty(${JSON.stringify(PANEL)}, ${JSON.stringify(data)})`)
const opened = () => app.main.eval<string[]>('globalThis.__opened')

function waitForText(text: string | RegExp, timeoutMs = 15000): Promise<unknown> {
  const test =
    typeof text === 'string'
      ? `.replace(/\\r?\\n/g, '').includes(${JSON.stringify(text)})`
      : `.match(new RegExp(${JSON.stringify(text.source)}, ${JSON.stringify(text.flags)}))`
  return cdp.waitFor(
    `window.__myterm.terminal(${JSON.stringify(PANEL)})?.text${test}`,
    `${String(text)} in ${PANEL}`,
    timeoutMs
  )
}

/** Runs a command line in the panel's shell after clearing the screen. */
async function run(command: string): Promise<void> {
  await writePty(`clear; ${command}\r`)
}

async function waitForPrompt(): Promise<void> {
  await cdp.waitFor(
    `(() => {
      const t = window.__myterm.terminal(${JSON.stringify(PANEL)})
      const lines = t.text.split('\\n')
      return t.cursorX === 5 && lines[lines.length - t.rows + t.cursorY]?.startsWith('e2e% ')
    })()`,
    'an idle prompt'
  )
}

async function focusTerminal(): Promise<void> {
  await cdp.eval(`document.querySelector('${PANEL_SELECTOR} .xterm-helper-textarea').focus()`)
}

async function pressKey(
  key: string,
  code: string,
  keyCode: number,
  modifiers: number,
  text?: string
): Promise<void> {
  const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }
  await cdp.send('Input.dispatchKeyEvent', {
    ...common,
    type: text ? 'keyDown' : 'rawKeyDown',
    ...(text ? { text, unmodifiedText: text } : {})
  })
  await cdp.send('Input.dispatchKeyEvent', { ...common, type: 'keyUp' })
}

/** Page coordinates of the middle of a terminal cell (viewport row, column). */
async function cellCenter(row: number, col: number): Promise<{ x: number; y: number }> {
  return cdp.eval(`(() => {
    const t = window.__myterm.terminal(${JSON.stringify(PANEL)})
    const r = document.querySelector('${PANEL_SELECTOR} .xterm-screen').getBoundingClientRect()
    const w = r.width / t.cols
    const h = r.height / t.rows
    return { x: r.left + (${col} + 0.5) * w, y: r.top + (${row} + 0.5) * h }
  })()`)
}

async function click(at: { x: number; y: number }, modifiers: number): Promise<void> {
  const base = { x: at.x, y: at.y, modifiers }
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' })
  // The link providers run on hover.
  await delay(300)
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', button: 'left', clickCount: 1 })
  await delay(300)
}

async function drop(at: { x: number; y: number }, files: string[]): Promise<void> {
  const data = { items: [], files, dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) {
    await cdp.send('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data })
  }
}

/** The viewport row just above the cursor (the last line a command printed). */
async function lineAboveCursor(): Promise<number> {
  return (await terminal()).cursorY - 1
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-e2e-')))
  userDataDir = path.join(root, 'user-data')
  const zdotdir = path.join(root, 'zdotdir')
  shimsDir = path.join(root, 'cmux-e2e-shims')
  for (const dir of [userDataDir, zdotdir, shimsDir]) fs.mkdirSync(dir)
  // An rc file must exist, or zsh opens its new-user menu.
  fs.writeFileSync(path.join(zdotdir, '.zshrc'), "PS1='e2e%# '\n")

  const state = {
    schemaVersion: 2,
    activeWorkspaceId: 'ws-a',
    lastUsedFolder: root,
    agentSettings: { claude: { command: 'claude' }, codex: { command: 'codex' } },
    window: { width: 1400, height: 900 },
    workspaces: [
      {
        id: 'ws-a',
        name: 'Alpha',
        layout: { rows: 1, cols: 1 },
        panels: [{ id: PANEL, title: 'Shell', cwd: root, agent: 'none', shell: '/bin/zsh' }],
        panelOrder: [PANEL]
      }
    ]
  }
  fs.writeFileSync(path.join(userDataDir, 'workspace-state.json'), JSON.stringify(state, null, 2))

  // As if the app were started from a shell inside cmux and Claude Code.
  app = await launchApp(userDataDir, {
    ZDOTDIR: zdotdir,
    TERM_PROGRAM: 'ghostty',
    TERM_PROGRAM_VERSION: '9.9.9',
    TERMINFO: path.join(root, 'fake-terminfo'),
    GHOSTTY_RESOURCES_DIR: path.join(root, 'fake-ghostty'),
    CMUX_CLAUDE_WRAPPER_SHIM_ROOT: shimsDir,
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'e2e',
    PATH: `${shimsDir}:${process.env.PATH ?? '/usr/bin:/bin'}`
  })
  cdp = app.cdp
  await cdp.waitFor('window.__myterm && window.__myterm.sessions().length === 1', 'the panel')
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await waitForText('e2e%')

  // Links go to the stub, never to a real browser.
  await app.main.eval(`(() => {
    globalThis.__opened = []
    ${M}.shell.openExternal = async (url) => { globalThis.__opened.push(url) }
  })()`)
})

afterAll(async () => {
  await app?.stop()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('terminal compatibility', () => {
  it('renders with the bundled JetBrains Mono and Unicode 11 widths', async () => {
    const loaded = await cdp.eval<string[]>(
      `[...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '') + ' ' + f.weight)`
    )
    expect(loaded).toEqual(expect.arrayContaining(['JetBrains Mono 400', 'JetBrains Mono 700']))

    const info = await terminal()
    expect(info.fontFamily.startsWith("'JetBrains Mono'")).toBe(true)
    expect(info.fontSize).toBe(13)
    expect(info.unicodeVersion).toBe('11')

    // Three emoji take two cells each, as agents' TUIs assume.
    await run(`printf 'XX\\360\\237\\230\\200\\360\\237\\230\\200\\360\\237\\230\\200'; sleep 3`)
    await waitForText('XX😀😀😀')
    expect((await terminal()).cursorX).toBe(8)
    await waitForPrompt()
  })

  it('paints the area below the last row in the terminal background', async () => {
    const color = await cdp.eval<string>(
      `getComputedStyle(document.querySelector('${PANEL_SELECTOR} .xterm-viewport')).backgroundColor`
    )
    expect(color).toBe('rgb(12, 15, 19)')
  })

  it('gives programs a clean environment that names this terminal', async () => {
    const leaked =
      "env | cut -d= -f1 | grep -cE '^(CMUX_|GHOSTTY_|TERMINFO$|CLAUDECODE$|CLAUDE_PID$|CLAUDE_CODE_(SESSION|MESSAGING|BRIDGE|ENTRYPOINT|EXECPATH))'"
    await run(
      `echo E2E""_ENV "term=$TERM_PROGRAM tpv=$TERM_PROGRAM_VERSION leaks=$(${leaked}) shims=$(echo $PATH | tr : '\\n' | grep -c cmux-e2e-shims) zdotdir=\${ZDOTDIR:+set}"`
    )
    await waitForText(/E2E_ENV term=\S* tpv=\S* leaks=\d+ shims=\d+ zdotdir=\S*/)
    const match = /E2E_ENV term=(\S*) tpv=(\S*) leaks=(\d+) shims=(\d+) zdotdir=(\S*)/.exec(
      (await terminal()).text
    )
    expect(match?.[1]).toBe('myterm')
    expect(match?.[2]).not.toBe('9.9.9')
    expect(match?.[2]).not.toBe('')
    expect(match?.[3]).toBe('0')
    expect(match?.[4]).toBe('0')
    // Variables of the user's own setup pass through.
    expect(match?.[5]).toBe('set')
    await waitForPrompt()
  })

  it('sends ESC CR for Shift+Enter and readline keys for Option/Cmd+arrows', async () => {
    await run('cat -v')
    await delay(300)
    await focusTerminal()
    await pressKey('ArrowLeft', 'ArrowLeft', 37, ALT)
    await pressKey('ArrowRight', 'ArrowRight', 39, ALT)
    await pressKey('ArrowLeft', 'ArrowLeft', 37, META)
    await pressKey('ArrowRight', 'ArrowRight', 39, META)
    await pressKey('Enter', 'Enter', 13, SHIFT, '\r')
    // cat -v prints ESC as ^[ and Ctrl+A/E as ^A/^E; the line ends at the CR.
    await waitForText('^[b^[f^A^E^[')
    expect((await terminal()).text).not.toContain('[1;3D')
    await writePty('\x03')
    await waitForPrompt()
  })

  it('opens http(s) links on Cmd+click only', async () => {
    await run(`printf 'https://example.com/e2e-%s\\n' web-link`)
    await waitForText('https://example.com/e2e-web-link')
    await waitForPrompt()
    const at = await cellCenter(await lineAboveCursor(), 4)

    await click(at, 0)
    expect(await opened()).toEqual([])

    await click(at, META)
    await app.main.waitFor('globalThis.__opened.length === 1', 'the link to open')
    expect(await opened()).toEqual(['https://example.com/e2e-web-link'])
  })

  it('opens OSC 8 hyperlinks on Cmd+click', async () => {
    await run(`printf '\\e]8;;https://example.com/e2e-osc8\\e\\\\OSC8LINK\\e]8;;\\e\\\\\\n'`)
    await waitForText(/^OSC8LINK$/m)
    await waitForPrompt()
    await click(await cellCenter(await lineAboveCursor(), 3), META)
    await app.main.waitFor('globalThis.__opened.length === 2', 'the hyperlink to open')
    expect((await opened())[1]).toBe('https://example.com/e2e-osc8')
  })

  it('opens nothing but http(s) URLs, from any source', async () => {
    // A user gesture, so window.open is never refused as a popup.
    await cdp.send('Runtime.evaluate', {
      userGesture: true,
      expression: `(() => {
      for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'vscode://x', 'ssh://h', 'not a url']) {
        window.electronAPI.openExternal(url)
      }
      window.electronAPI.openExternal('https://example.com/e2e-ipc')
      window.open('file:///etc/hosts')
      window.open('https://example.com/e2e-window-open')
    })()`
    })
    await app.main.waitFor('globalThis.__opened.length === 4', 'the allowed URLs to open')
    await delay(300)
    expect((await opened()).slice(2)).toEqual([
      'https://example.com/e2e-ipc',
      'https://example.com/e2e-window-open'
    ])
    expect(await app.main.eval(`${M}.BrowserWindow.getAllWindows().length`)).toBe(1)
  })

  it('types the escaped path of a dropped file at the cursor', async () => {
    const dir = path.join(root, 'drop dir')
    fs.mkdirSync(dir)
    const file = path.join(dir, "it's (1) $x ü.txt")
    fs.writeFileSync(file, 'dropped')

    await writePty(`clear; printf '<%s>\\n' `)
    await delay(300)
    const t = await terminal()
    const at = await cellCenter(Math.floor(t.rows / 2), Math.floor(t.cols / 2))
    await drop(at, [file])
    // The command line shows the path as typed: escaped.
    await waitForText('drop\\ dir/it\\\'s\\ \\(1\\)\\ \\$x\\ ')
    await writePty('\r')
    await waitForText(`<${file}>`)
    await waitForPrompt()
  })

  it('stays on its page when a file is dropped outside a terminal or a script navigates', async () => {
    const url = await cdp.eval<string>('location.href')
    await cdp.eval('window.__sentinel = 1')

    const sidebar = await cdp.eval<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('[data-workspace-id="ws-a"]').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    const file = path.join(root, 'outside.txt')
    fs.writeFileSync(file, 'outside')
    await drop(sidebar, [file])
    await cdp.eval(`location.href = 'https://example.com/e2e-navigate'`)
    await delay(1000)

    expect(await cdp.eval('location.href')).toBe(url)
    expect(await cdp.eval('window.__sentinel')).toBe(1)
  })
})
