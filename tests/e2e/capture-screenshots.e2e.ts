import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { launchApp, RunningApp, Cdp, delay } from './harness'

describe('Capture real screenshots for Dark and Light mode', () => {
  let root: string
  let userDataDir: string
  let app: RunningApp
  let cdp: Cdp

  const artifactDir = '/Users/sanakulov/.gemini/antigravity-cli/brain/9007ad06-046f-45fe-806e-a44bb07b1252'

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'myterm-screenshots-')))
    userDataDir = path.join(root, 'user-data')
    fs.mkdirSync(userDataDir)

    // Pre-populate state so we have a realistic workspace and panels
    const state = {
      schemaVersion: 3,
      workspaces: [
        {
          id: 'ws-main',
          name: 'Agent Terminal',
          rootPath: '/Users/sanakulov/Developer/myterm',
          layout: { mode: 'stack', rows: 1, cols: 2 },
          panels: [
            {
              id: 'panel-claude',
              title: 'Claude Code',
              cwd: '/Users/sanakulov/Developer/myterm',
              agent: 'claude',
              shell: '/bin/zsh'
            },
            {
              id: 'panel-shell',
              title: 'Shell',
              cwd: '/Users/sanakulov/Developer/myterm',
              agent: 'none',
              shell: '/bin/zsh'
            }
          ],
          panelOrder: ['panel-claude', 'panel-shell']
        }
      ],
      activeWorkspaceId: 'ws-main',
      agentSettings: {
        claude: { command: 'claude' },
        codex: { command: 'codex' }
      },
      window: { width: 1280, height: 800 },
      ui: {
        sidebarVisible: true,
        sidebarWidth: 264,
        collapsedWorkspaceIds: [],
        rightSlotWidth: 360,
        theme: 'dark',
        accent: 'blue',
        terminalFollowsTheme: true
      }
    }
    fs.writeFileSync(path.join(userDataDir, 'workspace-state.json'), JSON.stringify(state, null, 2))

    app = await launchApp(userDataDir, {})
    cdp = app.cdp
    await cdp.waitFor('window.__myterm && window.__myterm.sessions().length >= 2', 'sessions ready')
    await delay(1200)
  })

  afterAll(async () => {
    await app?.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('captures dark mode screenshot', async () => {
    await cdp.eval('window.electronAPI.setTheme("dark")')
    await delay(600)
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const base64 = (res.result as { data: string }).data
    fs.writeFileSync(path.join(artifactDir, 'screenshot-dark.png'), Buffer.from(base64, 'base64'))
    expect(fs.existsSync(path.join(artifactDir, 'screenshot-dark.png'))).toBe(true)
  })

  it('captures light mode screenshot', async () => {
    await cdp.eval('window.electronAPI.setTheme("light")')
    await delay(600)
    const res = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const base64 = (res.result as { data: string }).data
    fs.writeFileSync(path.join(artifactDir, 'screenshot-light.png'), Buffer.from(base64, 'base64'))
    expect(fs.existsSync(path.join(artifactDir, 'screenshot-light.png'))).toBe(true)
  })
})
