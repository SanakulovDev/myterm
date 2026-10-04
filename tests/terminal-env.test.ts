import { describe, it, expect } from 'vitest'
import { buildTerminalEnv, isInheritedTerminalVar } from '../src/main/terminal-env'
import { isSafeExternalUrl } from '../src/main/external-links'

// An app started from inside cmux (or another terminal, or a Claude Code
// session) must not hand that session's variables and PATH shims to its own
// shells.

const SHIMS = '/var/folders/x/T/cmux-cli-shims/A6C3'
const CMUX_BIN = '/Applications/cmux.app/Contents/Resources/bin'

const cmuxEnv: NodeJS.ProcessEnv = {
  HOME: '/Users/me',
  LANG: 'en_US.UTF-8',
  SSH_AUTH_SOCK: '/private/tmp/launchd/Listeners',
  PATH: [SHIMS, CMUX_BIN, '/Users/me/.local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', ''].join(':'),
  TERM: 'xterm-ghostty',
  TERM_PROGRAM: 'ghostty',
  TERM_PROGRAM_VERSION: '1.3.2',
  TERMINFO: '/Applications/cmux.app/Contents/Resources/terminfo',
  GHOSTTY_RESOURCES_DIR: '/Applications/cmux.app/Contents/Resources/ghostty',
  CMUX_SURFACE_ID: 'A6C3',
  CMUX_CLAUDE_WRAPPER_SHIM_ROOT: SHIMS,
  CMUX_BUNDLED_CLI_PATH: `${CMUX_BIN}/cmux`,
  CMUX_AGENT_LAUNCH_CWD: '/Users/me/Developer/myterm',
  __CFBundleIdentifier: 'com.cmuxterm.app',
  CLAUDECODE: '1',
  CLAUDE_PID: '37752',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_SESSION_ID: 'abc',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
  CLAUDE_CODE_EXECPATH: '/Users/me/.local/share/claude/versions/2.1.289',
  CLAUDE_CODE_USE_BEDROCK: '1',
  TMUX: '/private/tmp/tmux-501/default,1,0',
  TMUX_PANE: '%1'
}

describe('buildTerminalEnv', () => {
  const env = buildTerminalEnv(cmuxEnv, { TERM: 'xterm-256color', TERM_PROGRAM: 'myterm' })

  it("drops the parent terminal's and agent session's variables", () => {
    for (const name of [
      'TERM_PROGRAM_VERSION',
      'TERMINFO',
      'GHOSTTY_RESOURCES_DIR',
      'CMUX_SURFACE_ID',
      'CMUX_CLAUDE_WRAPPER_SHIM_ROOT',
      '__CFBundleIdentifier',
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_EXECPATH',
      'TMUX',
      'TMUX_PANE'
    ]) {
      expect(env, name).not.toHaveProperty(name)
    }
  })

  it('keeps everything else, including Claude Code user settings', () => {
    expect(env.HOME).toBe('/Users/me')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.SSH_AUTH_SOCK).toBe('/private/tmp/launchd/Listeners')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  })

  it("removes the PATH entries the parent terminal added, and only those", () => {
    expect(env.PATH).toBe(['/Users/me/.local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', ''].join(':'))
  })

  it('applies the overrides last', () => {
    expect(env.TERM).toBe('xterm-256color')
    expect(env.TERM_PROGRAM).toBe('myterm')
  })

  it('never removes the system PATH, whatever a dropped variable names', () => {
    const result = buildTerminalEnv(
      { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERMINFO: '/usr/share/terminfo', CMUX_X: '/usr/bin/env' },
      {}
    )
    expect(result.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin')
  })

  it('leaves a clean environment unchanged', () => {
    const clean = { HOME: '/Users/me', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
    expect(buildTerminalEnv(clean, {})).toEqual(clean)
  })

  it('classifies variables by name', () => {
    expect(isInheritedTerminalVar('ITERM_SESSION_ID')).toBe(true)
    expect(isInheritedTerminalVar('VSCODE_IPC_HOOK_CLI')).toBe(true)
    expect(isInheritedTerminalVar('CLAUDE_CODE_BRIDGE_SESSION_ID')).toBe(true)
    expect(isInheritedTerminalVar('CLAUDE_CODE_MAX_OUTPUT_TOKENS')).toBe(false)
    expect(isInheritedTerminalVar('TERM')).toBe(false)
    expect(isInheritedTerminalVar('COLORTERM')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows http and https links', () => {
    expect(isSafeExternalUrl('https://claude.ai/oauth/authorize?code=1')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:5173/')).toBe(true)
  })

  it('refuses every other scheme and non-URLs', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,hi',
      'vscode://file/x',
      'ssh://host',
      'smb://server/share',
      'not a url',
      '',
      `https://x/${'a'.repeat(9000)}`
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false)
    }
    expect(isSafeExternalUrl(undefined)).toBe(false)
    expect(isSafeExternalUrl({ toString: () => 'https://x' })).toBe(false)
  })
})
