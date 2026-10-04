import { spawn } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import {
  AGENTS,
  AgentDetectionEntry,
  AgentDetectionResult,
  AgentPresence,
  resolveAgentCommand
} from '../shared/agents'
import { AgentSettings } from '../shared/types'
import { isPosixShell, resolveDefaultShell } from './launch-script'
import { buildTerminalEnv } from './terminal-env'

/**
 * Shell script run as `<shell> -l -i -c DETECT_SCRIPT` to find which agent
 * commands a panel could launch. It runs in the same kind of shell as an
 * agent launch (login + interactive), so PATH comes from the same rc files
 * (.zprofile, .zshrc, nvm, ...).
 *
 * - The commands arrive newline-separated in an environment variable and are
 *   only referenced quoted; nothing is interpolated into this string.
 * - The results sit between two lines carrying a random nonce, so anything an
 *   rc file prints (banners, warnings) is ignored, and cannot fake a result.
 * - Only `index<TAB>presence<TAB>path` lines are printed: never an alias or
 *   function body, never a variable's value.
 * - 'found' means an executable file in PATH (what `exec` would run). A name
 *   only `command -v` knows (a function, alias or builtin) is 'shell'.
 */
export const DETECT_SCRIPT = `__mt_nonce=$MYTERM_DETECT_NONCE
__mt_cmds=$MYTERM_DETECT_CMDS
unset MYTERM_DETECT_NONCE MYTERM_DETECT_CMDS
if [ -n "\${ZSH_VERSION-}" ]; then setopt SH_WORD_SPLIT; else set -f; fi
__mt_nl='
'
printf '\\n%s:begin\\n' "$__mt_nonce"
__mt_i=0
IFS=$__mt_nl
for __mt_cmd in $__mt_cmds; do
  __mt_found=
  case $__mt_cmd in
    */*)
      if [ -f "$__mt_cmd" ] && [ -x "$__mt_cmd" ]; then __mt_found=$__mt_cmd; fi
      ;;
    *)
      IFS=:
      for __mt_dir in $PATH; do
        if [ -n "$__mt_dir" ] && [ -f "$__mt_dir/$__mt_cmd" ] && [ -x "$__mt_dir/$__mt_cmd" ]; then
          __mt_found=$__mt_dir/$__mt_cmd
          break
        fi
      done
      IFS=$__mt_nl
      ;;
  esac
  if [ -n "$__mt_found" ]; then
    printf '%s\\tfound\\t%s\\n' "$__mt_i" "$__mt_found"
  else
    case $__mt_cmd in
      */*) printf '%s\\tmissing\\t\\n' "$__mt_i" ;;
      *)
        # bash answers with a non-executable file in PATH too: a path here
        # is not something that runs.
        if __mt_what=$(command -v -- "$__mt_cmd" 2>/dev/null) && [ -n "$__mt_what" ]; then
          case $__mt_what in
            /*) printf '%s\\tmissing\\t\\n' "$__mt_i" ;;
            *) printf '%s\\tshell\\t\\n' "$__mt_i" ;;
          esac
        else
          printf '%s\\tmissing\\t\\n' "$__mt_i"
        fi
        ;;
    esac
  fi
  __mt_i=$((__mt_i + 1))
done
printf '%s:end\\n' "$__mt_nonce"
`

/** A slow rc file (nvm, conda) can take seconds; a hung one costs this much. */
export const DETECT_TIMEOUT_MS = 15_000
// rc banners are small; anything this large is not worth reading.
const MAX_OUTPUT = 1024 * 1024
const MAX_COMMAND_LENGTH = 4096
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

export interface DetectOptions {
  /** The shell to run; the user's login shell by default. */
  shell?: string
  /** Variables added to the sanitised app environment (tests: HOME, ZDOTDIR). */
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

export interface CommandPresence {
  presence: AgentPresence
  path?: string
}

export interface CommandDetection {
  shell: string
  results: CommandPresence[]
  error?: string
}

/** Commands the script can check: one line each, nothing a shell could misread. */
export function isCheckableCommand(command: string): boolean {
  return (
    command.length > 0 &&
    command.length <= MAX_COMMAND_LENGTH &&
    command.trim() === command &&
    !CONTROL_CHARS.test(command)
  )
}

/** The shell detection runs in: the login shell when POSIX, else zsh or sh. */
export function detectionShell(preferred?: string): string {
  const shell = preferred ?? resolveDefaultShell()
  if (isPosixShell(shell)) return shell
  return fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh'
}

/**
 * The results between the nonce lines, one per command (by index). Returns
 * null when the end line never came; a missing or malformed line is 'unknown'.
 */
export function parseDetectOutput(
  stdout: string,
  nonce: string,
  count: number
): CommandPresence[] | null {
  const begin = `${nonce}:begin\n`
  const start = stdout.indexOf(begin)
  if (start < 0) return null
  const bodyStart = start + begin.length
  const end = stdout.indexOf(`${nonce}:end`, bodyStart)
  if (end < 0) return null

  const results: CommandPresence[] = Array.from({ length: count }, () => ({
    presence: 'unknown' as const
  }))
  for (const line of stdout.slice(bodyStart, end).split('\n')) {
    const first = line.indexOf('\t')
    const second = line.indexOf('\t', first + 1)
    if (first < 0 || second < 0) continue
    const indexText = line.slice(0, first)
    const presence = line.slice(first + 1, second)
    const index = Number(indexText)
    if (!/^\d+$/.test(indexText) || index >= count) continue
    if (presence === 'found') {
      const found = line.slice(second + 1)
      results[index] = found ? { presence, path: found } : { presence }
    } else if (presence === 'shell' || presence === 'missing') {
      results[index] = { presence }
    }
  }
  return results
}

/** Look up `commands` in a login+interactive shell. Never rejects. */
export function detectCommands(
  commands: readonly string[],
  options: DetectOptions = {}
): Promise<CommandDetection> {
  const shell = detectionShell(options.shell)
  const unknown = (error: string): CommandDetection => ({
    shell,
    error,
    results: commands.map(() => ({ presence: 'unknown' as const }))
  })
  const invalid = commands.find((command) => !isCheckableCommand(command))
  if (invalid !== undefined) return Promise.resolve(unknown('A command name is not valid'))
  if (commands.length === 0) return Promise.resolve({ shell, results: [] })

  const nonce = crypto.randomBytes(16).toString('hex')
  const timeoutMs = options.timeoutMs ?? DETECT_TIMEOUT_MS

  return new Promise((resolve) => {
    let stdout = ''
    let settled = false
    let exited = false
    const finish = (result: CommandDetection): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, ['-l', '-i', '-c', DETECT_SCRIPT], {
        cwd: options.cwd ?? os.homedir(),
        env: buildTerminalEnv(process.env, {
          TERM: 'dumb',
          TERM_PROGRAM: 'myterm',
          ...options.env,
          MYTERM_DETECT_NONCE: nonce,
          MYTERM_DETECT_CMDS: commands.join('\n')
        }),
        // stderr is never read: rc files print to it, and it is nobody's data.
        stdio: ['ignore', 'pipe', 'ignore'],
        // Its own process group, so a timeout stops everything the rc files started.
        detached: true
      })
    } catch {
      finish(unknown(`Could not start ${shell}`))
      return
    }

    const killGroup = (): void => {
      if (exited || child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }

    // Also covers a shell that printed its results but never exits.
    const timer = setTimeout(() => {
      killGroup()
      finish(unknown(`The login shell did not answer within ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)

    child.on('error', () => {
      clearTimeout(timer)
      finish(unknown(`Could not start ${shell}`))
    })
    child.on('exit', () => {
      exited = true
      clearTimeout(timer)
    })

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      stdout += chunk
      if (stdout.length > MAX_OUTPUT) {
        killGroup()
        child.stdout?.destroy()
        finish(unknown('The login shell printed too much output'))
        return
      }
      const results = parseDetectOutput(stdout, nonce, commands.length)
      if (results) {
        // A daemon started by an rc file may keep the pipe open; stop reading.
        child.stdout?.destroy()
        finish({ shell, results })
      }
    })

    // Every output is in once the pipe closes; no end line means no result.
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const how = signal ? `signal ${signal}` : `code ${code}`
      finish(unknown(`The login shell exited (${how}) before reporting`))
    })
  })
}

/** What each known agent's command resolves to, given the saved settings. */
export function agentCommands(
  settings: Partial<AgentSettings> | undefined
): { id: string; command: string }[] {
  return AGENTS.map((agent) => ({ id: agent.id, command: resolveAgentCommand(agent.id, settings) }))
}

/** Detect every known agent. Commands that cannot be checked are 'unknown'. */
export async function detectAgents(
  settings: Partial<AgentSettings> | undefined,
  options: DetectOptions = {}
): Promise<AgentDetectionResult> {
  const agents = agentCommands(settings)
  const checkable = [...new Set(agents.map((a) => a.command).filter(isCheckableCommand))]
  const detection = await detectCommands(checkable, options)
  const byCommand = new Map(checkable.map((command, i) => [command, detection.results[i]]))

  const entries: AgentDetectionEntry[] = agents.map(({ id, command }) => {
    const result = byCommand.get(command) ?? { presence: 'unknown' as const }
    return { id, command, ...result }
  })
  return detection.error
    ? { shell: detection.shell, agents: entries, error: detection.error }
    : { shell: detection.shell, agents: entries }
}

/**
 * Detection is slow (a login shell), so the result is kept until the commands
 * change or a refresh is asked for. A failed run is not kept.
 */
export class AgentDetector {
  private cache: { key: string; result: Promise<AgentDetectionResult> } | null = null

  constructor(
    private readonly getSettings: () => Partial<AgentSettings> | undefined,
    private readonly options: DetectOptions = {}
  ) {}

  detect(refresh = false): Promise<AgentDetectionResult> {
    const settings = this.getSettings()
    const key = JSON.stringify(agentCommands(settings))
    if (!refresh && this.cache?.key === key) return this.cache.result

    const result = detectAgents(settings, this.options)
    const entry = { key, result }
    this.cache = entry
    void result.then((value) => {
      if (value.error && this.cache === entry) this.cache = null
    })
    return result
  }
}
