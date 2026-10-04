import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, RunningApp, Cdp } from './harness'
import { AGENTS } from '../../src/shared/agents'

// Agent picking and prompting through the UI: the New Panel dialog, the
// command bar and the Launch presets, with fake agents (fixture in --read
// mode) standing in for claude and gemini.
//
// Every agent command is an absolute path or a name that cannot exist: the
// login shell's PATH (path_helper, the user's PATH) may hold real agents,
// which must neither be found nor run here.

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-agent.sh')

let root: string
let userDataDir: string
let projectDir: string
let zdotdir: string
let fakeClaude: string
let fakeGemini: string
let app: RunningApp
let cdp: Cdp

const sessionIds = () => cdp.eval<string[]>('window.__myterm.sessions().map((s) => s.id)')
const textOf = async (id: string) =>
  (await cdp.eval<{ text: string } | null>(`window.__myterm.terminal(${JSON.stringify(id)})`))?.text ?? ''

function waitForText(id: string, text: string, timeoutMs = 15000): Promise<unknown> {
  return cdp.waitFor(
    `window.__myterm.terminal(${JSON.stringify(id)})?.text.includes(${JSON.stringify(text)})`,
    `${JSON.stringify(text)} in ${id}`,
    timeoutMs
  )
}

/** The id of the first session that is not in `known`. */
function waitForNewSession(known: string[]): Promise<string> {
  return cdp.waitFor<string>(
    `window.__myterm.sessions().map((s) => s.id).find((id) => !${JSON.stringify(known)}.includes(id))`,
    'new panel session'
  )
}

/** Sets a React-controlled input or textarea, as typing would. */
function setValue(selector: string, value: string): Promise<unknown> {
  return cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}

const click = (selector: string) => cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`)

const pressEnter = (selector: string) =>
  cdp.eval(
    `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`
  )

function fakeAgent(name: string): string {
  const file = path.join(root, 'bin', name)
  fs.copyFileSync(FIXTURE, file)
  fs.chmodSync(file, 0o755)
  return file
}

async function startApp(): Promise<void> {
  app = await launchApp(userDataDir, {
    ZDOTDIR: zdotdir,
    // Nothing here runs the real claude; this keeps any stray run away from
    // the user's Claude configuration all the same.
    CLAUDE_CONFIG_DIR: path.join(root, 'claude-config')
  })
  cdp = app.cdp
}

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-e2e-agents-')))
  userDataDir = path.join(root, 'user-data')
  projectDir = path.join(root, 'project')
  zdotdir = path.join(root, 'zdotdir')
  for (const dir of [userDataDir, projectDir, zdotdir, path.join(root, 'bin'), path.join(root, 'claude-config')]) {
    fs.mkdirSync(dir)
  }
  fs.writeFileSync(path.join(zdotdir, '.zshrc'), "PS1='e2e%# '\n")
  fakeClaude = fakeAgent('fake-claude')
  fakeGemini = fakeAgent('fake-gemini')

  const agentSettings: Record<string, { command: string; args?: string }> = {}
  for (const agent of AGENTS) agentSettings[agent.id] = { command: `myterm-missing-${agent.id}` }
  agentSettings.claude = { command: fakeClaude, args: '--read' }
  agentSettings.gemini = { command: fakeGemini, args: '--read' }

  const state = {
    schemaVersion: 2,
    activeWorkspaceId: 'ws-a',
    lastUsedFolder: projectDir,
    agentSettings,
    window: { width: 1400, height: 900 },
    workspaces: [
      {
        id: 'ws-a',
        name: 'Alpha',
        layout: { rows: 1, cols: 1 },
        panels: [{ id: 's1', title: 'Shell 1', cwd: projectDir, agent: 'none', shell: '/bin/zsh' }],
        panelOrder: ['s1']
      }
    ]
  }
  fs.writeFileSync(path.join(userDataDir, 'workspace-state.json'), JSON.stringify(state, null, 2))

  await startApp()
  await cdp.waitFor('window.__myterm && window.__myterm.sessions().length === 1', 'first workspace')
  await waitForText('s1', 'e2e%')
})

afterAll(async () => {
  await app?.stop()
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('agents', () => {
  let geminiId = ''

  it('lists installed agents first, and missing ones apart with their install command', async () => {
    await click('[data-open-new-panel]')
    await cdp.waitFor(
      `document.querySelector('[data-agent-choice="claude"]')?.dataset.presence === 'found'`,
      'agent detection'
    )
    const tiles = await cdp.eval<string[]>(
      `[...document.querySelectorAll('[data-agent-choice]')].map((el) => el.dataset.agentChoice)`
    )
    expect(tiles).toEqual(['claude', 'gemini', 'none', 'custom'])
    expect(await cdp.eval(`document.querySelector('[data-agent-choice="claude"]').getAttribute('aria-pressed')`)).toBe(
      'true'
    )
    const missing = await cdp.eval<string[]>(
      `[...document.querySelectorAll('[data-missing-agent]')].map((el) => el.dataset.missingAgent)`
    )
    expect(missing.sort()).toEqual(AGENTS.map((a) => a.id).filter((id) => id !== 'claude' && id !== 'gemini').sort())
    expect(
      await cdp.eval<string>(`document.querySelector('[data-missing-agent="codex"] code').textContent`)
    ).toBe('npm install -g @openai/codex')
  })

  it('starts a gemini panel with its first prompt after -i, as one argument', async () => {
    const before = await sessionIds()
    await click('[data-agent-choice="gemini"]')
    await setValue('[data-first-prompt]', 'say "hi" $(touch pwned)')
    await click('[data-new-panel-submit]')

    geminiId = await waitForNewSession(before)
    await waitForText(geminiId, 'FAKE_AGENT_READING')
    const text = await textOf(geminiId)
    expect(text).toContain('FAKE_AGENT_ARGC=3')
    expect(text).toContain('FAKE_AGENT_ARG=[--read]\nFAKE_AGENT_ARG=[-i]\nFAKE_AGENT_ARG=[say "hi" $(touch pwned)]')
    expect(text).toContain(`FAKE_AGENT_CWD=[${projectDir}]`)
    expect(fs.existsSync(path.join(projectDir, 'pwned'))).toBe(false)
    expect(await cdp.eval('!!document.querySelector("[data-new-panel-modal]")')).toBe(false)
  })

  it('sends a command bar prompt to the agent running in the active panel', async () => {
    await cdp.waitFor(`document.querySelector('[data-command-hint]').textContent === 'to Gemini CLI'`, 'hint')
    await setValue('[data-command-input]', 'second prompt')
    await pressEnter('[data-command-input]')
    await waitForText(geminiId, 'FAKE_AGENT_GOT=[second prompt]')
    expect(await cdp.eval(`document.querySelector('[data-command-input]').value`)).toBe('')
  })

  it('starts an agent with the prompt when nothing runs in the active panel', async () => {
    await click('[data-panel-id="s1"] .panel-header')
    await cdp.waitFor(`document.querySelector('[data-command-hint]').textContent === 'starts Claude Code'`, 'hint')
    const before = await sessionIds()
    await setValue('[data-command-input]', '-looks like an option')
    await pressEnter('[data-command-input]')

    const id = await waitForNewSession(before)
    await waitForText(id, 'FAKE_AGENT_READING')
    expect(await textOf(id)).toContain(
      'FAKE_AGENT_ARG=[--read]\nFAKE_AGENT_ARG=[--]\nFAKE_AGENT_ARG=[-looks like an option]'
    )
    // The new agent is active and running: the next prompt goes to it.
    await cdp.waitFor(`document.querySelector('[data-command-hint]').textContent === 'to Claude Code'`, 'hint')
  })

  it('sends to an agent typed into a shell by hand, which has no status of its own', async () => {
    await click('[data-panel-id="s1"] .panel-header')
    await cdp.waitFor(`document.querySelector('[data-command-hint]').textContent === 'starts Claude Code'`, 'hint')
    await cdp.eval(`window.electronAPI.writePty('s1', ${JSON.stringify(`'${fakeClaude}' --read\r`)})`)
    await waitForText('s1', 'FAKE_AGENT_READING')

    // Focusing the bar asks main again whether a command runs in the panel.
    await cdp.eval(`document.querySelector('[data-command-input]').focus()`)
    await cdp.waitFor(`document.querySelector('[data-command-hint]').textContent === 'to Shell 1'`, 'hint')
    const before = await sessionIds()
    await setValue('[data-command-input]', 'typed by hand')
    await pressEnter('[data-command-input]')
    await waitForText('s1', 'FAKE_AGENT_GOT=[typed by hand]')
    expect(await sessionIds()).toEqual(before)
  })

  it('launches a swarm into a new workspace, each agent with its role and the task', async () => {
    const before = await sessionIds()
    await click('[data-open-launch]')
    await click('[data-preset="swarm"]')
    expect(
      await cdp.eval<string[]>(`[...document.querySelectorAll('[data-slot-agent]')].map((el) => el.value)`)
    ).toEqual(['claude', 'gemini', 'claude', 'gemini'])
    await setValue('[data-launch-task]', 'add a health check')
    await click('[data-launch-submit]')

    await cdp.waitFor(
      `window.__myterm.sessions().filter((s) => s.visible && !${JSON.stringify(before)}.includes(s.id)).length === 4`,
      'four new panels'
    )
    const ids = await cdp.eval<string[]>(
      `window.__myterm.sessions().filter((s) => s.visible).map((s) => s.id)`
    )
    expect(ids).toHaveLength(4)
    for (const id of ids) await waitForText(id, 'FAKE_AGENT_READING')

    const texts = await Promise.all(ids.map(textOf))
    const roles = ['architect', 'builder', 'reviewer', 'tester']
    texts.forEach((text, i) => {
      expect(text).toContain(i % 2 === 0 ? 'FAKE_AGENT_ARG=[--]' : 'FAKE_AGENT_ARG=[-i]')
      expect(text).toContain(`You are the ${roles[i]}`)
      expect(text).toContain('Task: add a health check]')
    })
    expect(
      await cdp.eval<string>(`document.querySelector('[data-workspace-id].active')?.textContent ?? ''`)
    ).toContain('Swarm')
  })

  it('reopens every agent panel as a plain shell after a restart', async () => {
    const swarmIds = await cdp.eval<string[]>(
      `window.__myterm.sessions().filter((s) => s.visible).map((s) => s.id)`
    )
    await app.stop()
    await startApp()
    await cdp.waitFor(
      `window.__myterm && window.__myterm.sessions().filter((s) => s.visible).length === 4`,
      'restored workspace'
    )
    for (const id of swarmIds) {
      await waitForText(id, 'e2e%')
      const text = await textOf(id)
      // The restored output shows the old run once; nothing ran again.
      expect(text.split('FAKE_AGENT_READING').length - 1).toBe(1)
    }
  })
})
