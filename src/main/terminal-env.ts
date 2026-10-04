import * as path from 'path'

// An app started from inside another terminal or agent session (`npm run
// dev` in cmux, Ghostty, iTerm2, VS Code, tmux or Claude Code) inherits the
// variables that session set for its own children. Passed on to our shells
// they make everything in a panel believe it runs inside that other terminal:
// a wrong TERM_PROGRAM and terminfo, wrapper shims and hooks that report to
// the other app (cmux puts its own `claude`, `codex` and `open` first in
// PATH), and another agent session's ids and tokens. A packaged app started
// from the Dock never has them; this makes dev runs behave the same.
const INHERITED_PREFIXES = [
  'CMUX_',
  'GHOSTTY_',
  'ITERM_',
  'KITTY_',
  'WEZTERM_',
  'ALACRITTY_',
  'KONSOLE_',
  'VSCODE_',
  'TMUX',
  'ZELLIJ'
]

const INHERITED_NAMES = new Set([
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'TERMINFO',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'COLORFGBG',
  'VTE_VERSION',
  'WINDOWID',
  'WT_SESSION',
  'STY',
  '__CFBundleIdentifier',
  'CLAUDECODE',
  'CLAUDE_PID'
])

// Claude Code's per-session variables. User settings such as
// CLAUDE_CODE_USE_BEDROCK are kept.
const CLAUDE_SESSION = /^CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_.*|.*_SESSION(_.*)?|MESSAGING_.*|BRIDGE_.*)$/

// launchd's PATH for apps started from the Dock; never removed.
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']

export function isInheritedTerminalVar(name: string): boolean {
  return (
    INHERITED_NAMES.has(name) ||
    INHERITED_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    CLAUDE_SESSION.test(name)
  )
}

/**
 * The environment for a panel's shell: the app's own environment without
 * another terminal's variables, and without the PATH entries that terminal
 * added (a directory named by one of its variables, or holding a file one of
 * them names). Then `overrides`, which always win.
 */
export function buildTerminalEnv(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string>
): Record<string, string> {
  const env: Record<string, string> = {}
  const foreignDirs = new Set<string>()
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (!isInheritedTerminalVar(name)) {
      env[name] = value
    } else if (path.isAbsolute(value)) {
      foreignDirs.add(path.normalize(value))
      foreignDirs.add(path.dirname(path.normalize(value)))
    }
  }
  for (const dir of SYSTEM_PATH) foreignDirs.delete(dir)

  if (env.PATH !== undefined) {
    env.PATH = env.PATH.split(':')
      .filter((entry) => entry === '' || !foreignDirs.has(path.normalize(entry)))
      .join(':')
  }
  return { ...env, ...overrides }
}
