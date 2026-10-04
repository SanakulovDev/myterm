import * as pty from 'node-pty'
import { execFileSync } from 'child_process'
import { randomBytes } from 'crypto'
import { SpawnPtyOptions } from '../shared/types'
import { buildLaunchSpawn, resolveDefaultShell, UNSUPPORTED_SHELL_BANNER } from './launch-script'
import { LaunchMarkerParser, PtyLaunchEvent } from './launch-marker'
import { buildTerminalEnv } from './terminal-env'

// A marker split across reads completes on the very next read; anything held
// longer than this is not a marker and is released verbatim.
const STALE_MARKER_FLUSH_MS = 100

interface PtyEntry {
  process: pty.IPty
  generation: number
  markerParser: LaunchMarkerParser | null
  // Command of a launched agent that has not reported its exit yet.
  runningAgent: string | null
}

export interface BusyPanel {
  id: string
  /** The launched agent, or the foreground process the kernel reports. */
  process: string
}

/** Shell pid -> process group in the foreground of that shell's terminal. */
export type ForegroundGroupReader = (pids: number[]) => Map<number, number>

export class PtyManager {
  private ptys: Map<string, PtyEntry> = new Map()
  private buffers: Map<string, string> = new Map()
  private flushTimers: Map<string, NodeJS.Timeout> = new Map()
  private markerTimers: Map<string, NodeJS.Timeout> = new Map()
  private socketPath?: string
  private appVersion = ''
  private generationCounter = 0
  private intentionallyKilledGenerations: Set<number> = new Set()
  private readForegroundGroups: ForegroundGroupReader

  constructor(socketPath?: string, readForegroundGroups = readForegroundGroupsWithPs) {
    this.socketPath = socketPath
    this.readForegroundGroups = readForegroundGroups
  }

  public setSocketPath(socketPath: string): void {
    this.socketPath = socketPath
  }

  /** Reported to programs in a panel as TERM_PROGRAM_VERSION. */
  public setAppVersion(version: string): void {
    this.appVersion = version
  }

  public spawn(
    options: SpawnPtyOptions,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
    onLaunchEvent?: (event: PtyLaunchEvent) => void
  ): boolean {
    if (this.ptys.has(options.id)) {
      this.kill(options.id)
    }

    const generation = ++this.generationCounter

    const shell = options.shell || resolveDefaultShell()
    const nonce = randomBytes(16).toString('hex')
    const plan = buildLaunchSpawn(shell, options.launch, nonce)

    const env = buildTerminalEnv(process.env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'myterm',
      ...(this.appVersion ? { TERM_PROGRAM_VERSION: this.appVersion } : {}),
      AGENT_TERMINAL_PANEL_ID: options.id,
      ...(this.socketPath ? { AGENT_TERMINAL_SOCKET: this.socketPath } : {}),
      ...(options.env || {}),
      ...plan.env
    })

    try {
      const ptyProcess = pty.spawn(shell, plan.args, {
        name: 'xterm-256color',
        cols: options.cols || 80,
        rows: options.rows || 24,
        cwd: options.cwd || process.env.HOME || '/',
        env
      })

      const markerParser = plan.kind === 'launch' ? new LaunchMarkerParser(nonce) : null
      const entry: PtyEntry = {
        process: ptyProcess,
        generation,
        markerParser,
        runningAgent: plan.kind === 'launch' ? plan.command : null
      }
      this.ptys.set(options.id, entry)
      this.buffers.set(options.id, '')

      const isCurrent = (): boolean => this.ptys.get(options.id)?.generation === generation

      ptyProcess.onData((data: string) => {
        // If superseded by a newer generation, discard
        if (!isCurrent()) {
          return
        }

        if (!markerParser) {
          this.appendOutput(options.id, data, onData)
          return
        }

        this.clearMarkerTimer(options.id)
        const result = markerParser.push(data)
        if (result.output) {
          this.appendOutput(options.id, result.output, onData)
        }
        if (result.event && plan.kind === 'launch') {
          // Every marker (exit or missing) means the agent is gone.
          entry.runningAgent = null
          onLaunchEvent?.({ ...result.event, command: plan.command })
        }
        if (markerParser.hasPending()) {
          const timer = setTimeout(() => {
            this.markerTimers.delete(options.id)
            if (!isCurrent()) return
            const held = markerParser.flush()
            if (held) this.appendOutput(options.id, held, onData)
          }, STALE_MARKER_FLUSH_MS)
          this.markerTimers.set(options.id, timer)
        }
      })

      ptyProcess.onExit(({ exitCode }) => {
        if (isCurrent()) {
          this.clearMarkerTimer(options.id)
          const held = markerParser?.flush()
          if (held) this.appendOutput(options.id, held, onData)
          this.flushBuffer(options.id, onData)

          const timer = this.flushTimers.get(options.id)
          if (timer) {
            clearTimeout(timer)
            this.flushTimers.delete(options.id)
          }
          this.buffers.delete(options.id)
        }

        // If this process was intentionally killed or replaced, do not trigger error exit
        if (this.intentionallyKilledGenerations.has(generation)) {
          this.intentionallyKilledGenerations.delete(generation)
          return
        }

        if (isCurrent()) {
          this.ptys.delete(options.id)
          onExit(exitCode)
        }
      })

      if (plan.kind === 'launch') {
        onLaunchEvent?.({ type: 'started', command: plan.command })
      } else if (plan.kind === 'unsupported-shell') {
        this.appendOutput(options.id, UNSUPPORTED_SHELL_BANNER, onData)
        onLaunchEvent?.({ type: 'unsupported-shell', shell })
      }

      return true
    } catch (err) {
      console.error(`Failed to spawn PTY for panel ${options.id}:`, err)
      return false
    }
  }

  // Batch PTY output (flush every 12ms or when exceeding threshold)
  private appendOutput(id: string, data: string, onData: (data: string) => void): void {
    const currentBuf = (this.buffers.get(id) || '') + data
    this.buffers.set(id, currentBuf)

    if (currentBuf.length > 32768) {
      this.flushBuffer(id, onData)
    } else if (!this.flushTimers.has(id)) {
      const timer = setTimeout(() => {
        this.flushTimers.delete(id)
        this.flushBuffer(id, onData)
      }, 12)
      this.flushTimers.set(id, timer)
    }
  }

  private clearMarkerTimer(id: string): void {
    const timer = this.markerTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.markerTimers.delete(id)
    }
  }

  private flushBuffer(id: string, onData: (data: string) => void): void {
    const buf = this.buffers.get(id)
    if (buf && buf.length > 0) {
      this.buffers.set(id, '')
      onData(buf)
    }
  }

  public write(id: string, data: string): void {
    const entry = this.ptys.get(id)
    if (entry) {
      entry.process.write(data)
    }
  }

  public resize(id: string, cols: number, rows: number): void {
    const entry = this.ptys.get(id)
    if (entry && cols > 0 && rows > 0) {
      try {
        entry.process.resize(cols, rows)
      } catch (err) {
        console.warn(`Failed to resize PTY ${id}:`, err)
      }
    }
  }

  public kill(id: string): void {
    const timer = this.flushTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.flushTimers.delete(id)
    }
    this.clearMarkerTimer(id)
    this.buffers.delete(id)

    const entry = this.ptys.get(id)
    if (entry) {
      this.intentionallyKilledGenerations.add(entry.generation)
      try {
        entry.process.kill()
      } catch (err) {
        console.warn(`Failed to kill PTY ${id}:`, err)
      }
      this.ptys.delete(id)
    }
  }

  public killAll(): void {
    for (const [id] of this.ptys) {
      this.kill(id)
    }
  }

  public hasPty(id: string): boolean {
    return this.ptys.has(id)
  }

  /**
   * Panels running something besides an idle shell: a launched agent that
   * has not exited, or any foreground job (an agent or tool started by hand).
   *
   * The shell leads its own process group, and job control gives every
   * command line its own group, so "the terminal's foreground group is not
   * the shell's" is exactly "a command is running". Process names cannot
   * tell this: /bin/sh runs as "bash", and `bash -c` started from bash looks
   * like the shell. An idle shell is never busy; a terminal whose foreground
   * group cannot be read counts as idle.
   */
  public busyPanels(): BusyPanel[] {
    const busy: BusyPanel[] = []
    const shells: Array<[string, PtyEntry]> = []
    for (const [id, entry] of this.ptys) {
      if (entry.runningAgent) busy.push({ id, process: entry.runningAgent })
      else shells.push([id, entry])
    }
    if (shells.length === 0) return busy

    let groups: Map<number, number>
    try {
      groups = this.readForegroundGroups(shells.map(([, entry]) => entry.process.pid))
    } catch (err) {
      console.warn('Could not read terminal foreground process groups:', err)
      return busy
    }
    for (const [id, entry] of shells) {
      const group = groups.get(entry.process.pid)
      if (group === undefined || group <= 0 || group === entry.process.pid) continue
      busy.push({ id, process: foregroundProcess(entry.process) ?? 'unknown process' })
    }
    return busy
  }
}

/** `ps` reports the terminal's foreground process group (tpgid) per pid. */
function readForegroundGroupsWithPs(pids: number[]): Map<number, number> {
  let output: string
  try {
    output = execFileSync('ps', ['-o', 'pid=,tpgid=', '-p', pids.join(',')], {
      encoding: 'utf8',
      timeout: 2000
    })
  } catch (err) {
    // ps exits 1 when one of the pids is gone (a shell that just exited)
    // but still lists the others.
    const stdout = (err as { stdout?: unknown }).stdout
    if (typeof stdout !== 'string' || stdout === '') throw err
    output = stdout
  }
  return parseForegroundGroups(output)
}

export function parseForegroundGroups(output: string): Map<number, number> {
  const groups = new Map<number, number>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(-?\d+)\s*$/.exec(line)
    if (match) groups.set(Number(match[1]), Number(match[2]))
  }
  return groups
}

// node-pty asks the kernel for the name of the terminal's foreground process
// group leader (tcgetpgrp + sysctl on macOS); at most 16 characters.
function foregroundProcess(ptyProcess: pty.IPty): string | null {
  try {
    return ptyProcess.process || null
  } catch {
    return null
  }
}
