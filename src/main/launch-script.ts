import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { LaunchSpec } from '../shared/types'
import { MAX_PROMPT_LENGTH } from '../shared/agents'

/**
 * Shell script run as `<shell> -l -i -c LAUNCH_SCRIPT` to auto-launch an agent.
 *
 * Every user-controlled value (command, args, shell path, nonce) arrives through
 * environment variables and is only referenced quoted; nothing is interpolated
 * into this string. The working directory is set via the PTY `cwd` option.
 *
 * - `command -v` runs inside this same login+interactive shell, so the lookup
 *   uses exactly the PATH the agent will be launched with (.zshrc, nvm, ...).
 * - Extra args are word-split on whitespace on purpose (SH_WORD_SPLIT in zsh);
 *   quotes are not interpreted and globbing is disabled (`set -f` in sh/bash,
 *   zsh does not glob parameter expansions by default).
 * - A first prompt is always one argument, exactly as typed: after the prompt
 *   flag, or after `--` for agents that take it positionally (so a prompt
 *   starting with "-" is never read as an option).
 * - `trap ':' INT` keeps the script alive when Ctrl+C reaches the whole
 *   foreground group: a caught trap is reset to default on exec, so the agent
 *   still receives SIGINT normally, while the shell survives to print the
 *   marker and exec the fallback shell. (`trap '' INT` would be inherited and
 *   make the agent ignore Ctrl+C.)
 * - Right before exec, a private OSC 6973 marker reports the agent's exit code
 *   (or that the command is missing). The main process strips it from output.
 */
export const LAUNCH_SCRIPT = `__mt_cmd=$MYTERM_AGENT_CMD
__mt_args=$MYTERM_AGENT_ARGS
__mt_shell=$MYTERM_SHELL
__mt_nonce=$MYTERM_LAUNCH_NONCE
__mt_prompt=\${MYTERM_AGENT_PROMPT-}
__mt_pflag=\${MYTERM_AGENT_PROMPT_FLAG-}
unset MYTERM_AGENT_CMD MYTERM_AGENT_ARGS MYTERM_SHELL MYTERM_LAUNCH_NONCE MYTERM_AGENT_PROMPT MYTERM_AGENT_PROMPT_FLAG
IFS=' \t\n'
if [ -n "\${ZSH_VERSION-}" ]; then setopt SH_WORD_SPLIT; else set -f; fi
if command -v -- "$__mt_cmd" >/dev/null 2>&1; then
  trap ':' INT
  if [ -z "$__mt_prompt" ]; then
    "$__mt_cmd" $__mt_args
  elif [ -n "$__mt_pflag" ]; then
    "$__mt_cmd" $__mt_args "$__mt_pflag" "$__mt_prompt"
  else
    "$__mt_cmd" $__mt_args -- "$__mt_prompt"
  fi
  __mt_rc=$?
  trap - INT
  printf '\\033]6973;myterm;%s;exit;%d\\007' "$__mt_nonce" "$__mt_rc"
else
  printf '\\n\\033[1;33m[Agent Terminal]\\033[0m Command "%s" not found in PATH.\\nInstall it or set the full path in agent settings.\\n\\n' "$__mt_cmd"
  printf '\\033]6973;myterm;%s;missing\\007' "$__mt_nonce"
fi
exec "$__mt_shell" -l
`

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash'])

export function isPosixShell(shell: string): boolean {
  return POSIX_SHELLS.has(path.basename(shell))
}

export function resolveDefaultShell(): string {
  const candidates: (string | undefined)[] = []
  try {
    candidates.push(os.userInfo().shell ?? undefined)
  } catch {
    // userInfo can throw when the user has no passwd entry
  }
  candidates.push(process.env.SHELL, '/bin/zsh')
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return '/bin/zsh'
}

export const UNSUPPORTED_SHELL_BANNER =
  '\r\n\x1b[1;33m[Agent Terminal]\x1b[0m Auto-launch needs a POSIX shell (zsh, bash, sh). ' +
  'Started a plain shell instead.\r\n\r\n'

export type LaunchPlan =
  | { kind: 'plain'; args: string[]; env: Record<string, string> }
  | { kind: 'launch'; args: string[]; env: Record<string, string>; command: string }
  | { kind: 'unsupported-shell'; args: string[]; env: Record<string, string> }

// The prompt flag must look like an option: anything else would be an
// arbitrary extra argument.
const PROMPT_FLAG = /^--?[A-Za-z][A-Za-z0-9-]*$/

function promptEnv(launch: LaunchSpec | undefined): Record<string, string> {
  const prompt = launch?.prompt ?? ''
  if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) return {}
  const flag = launch?.promptFlag ?? ''
  if (flag && !PROMPT_FLAG.test(flag)) return {}
  return { MYTERM_AGENT_PROMPT: prompt, MYTERM_AGENT_PROMPT_FLAG: flag }
}

/** Decide how to spawn `shell` for a panel, with or without an agent launch. */
export function buildLaunchSpawn(
  shell: string,
  launch: LaunchSpec | undefined,
  nonce: string
): LaunchPlan {
  const command = launch?.command.trim() ?? ''
  if (!command) {
    return { kind: 'plain', args: ['-l'], env: {} }
  }
  if (!isPosixShell(shell)) {
    return { kind: 'unsupported-shell', args: ['-l'], env: {} }
  }
  return {
    kind: 'launch',
    command,
    args: ['-l', '-i', '-c', LAUNCH_SCRIPT],
    env: {
      MYTERM_AGENT_CMD: command,
      MYTERM_AGENT_ARGS: launch?.args?.trim() ?? '',
      MYTERM_SHELL: shell,
      MYTERM_LAUNCH_NONCE: nonce,
      ...promptEnv(launch)
    }
  }
}
