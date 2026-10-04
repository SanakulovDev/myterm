import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'
import { APP_DIR } from './harness'

// Test hooks (window.__myterm, the main-process hooks, MYTERM_DEBUG) must be
// compiled out of release builds. npm run package runs the same check, and
// its afterPack hook scans app.asar and turns the Node-related fuses off.

const PROJECT_ROOT = path.resolve(__dirname, '../..')
const checkRelease = (...args: string[]) =>
  spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'check-release.mjs'), ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, MYTERM_TEST_HOOKS: '' }
  })

describe('release build', () => {
  it('a production build contains no test hooks', () => {
    const result = checkRelease()
    expect(result.stderr).not.toContain('Release check failed')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Release check passed')
  })

  it('the check does catch the hooks in the test build', () => {
    const result = checkRelease('--dir', APP_DIR)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/test hook "__myterm" in .*main[/\\]index\.js/)
    expect(result.stderr).toMatch(/test hook "MYTERM_DEBUG" in .*preload[/\\]index\.js/)
    expect(result.stderr).toMatch(/test hook "__myterm" in .*renderer[/\\]assets[/\\]/)
  })
})
