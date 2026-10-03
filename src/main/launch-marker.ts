import { PanelStatus } from '../shared/types'

/** Emitted by the launch script right before it execs the fallback shell. */
export type LaunchMarkerEvent = { type: 'exit'; code: number } | { type: 'missing' }

/** Everything the PTY manager reports about an auto-launch. */
export type PtyLaunchEvent =
  | { type: 'started'; command: string }
  | { type: 'unsupported-shell'; shell: string }
  | { type: 'exit'; code: number; command: string }
  | { type: 'missing'; command: string }

const PREFIX = '\x1b]6973;'
const MAX_MARKER_LENGTH = 256
const BODY_CHAR = /[A-Za-z0-9;-]/

type Scan =
  | { kind: 'incomplete' }
  | { kind: 'invalid' }
  | { kind: 'complete'; body: string; end: number }

function scanMarker(data: string, start: number): Scan {
  const bodyStart = start + PREFIX.length
  for (let i = bodyStart; i < data.length; i++) {
    if (i - start > MAX_MARKER_LENGTH) return { kind: 'invalid' }
    const ch = data[i]
    if (ch === '\x07') return { kind: 'complete', body: data.slice(bodyStart, i), end: i + 1 }
    if (ch === '\x1b') {
      if (i + 1 >= data.length) return { kind: 'incomplete' }
      if (data[i + 1] === '\\') {
        return { kind: 'complete', body: data.slice(bodyStart, i), end: i + 2 }
      }
      return { kind: 'invalid' }
    }
    if (!BODY_CHAR.test(ch)) return { kind: 'invalid' }
  }
  return data.length - start > MAX_MARKER_LENGTH ? { kind: 'invalid' } : { kind: 'incomplete' }
}

function parseBody(body: string, nonce: string): LaunchMarkerEvent | null {
  const parts = body.split(';')
  if (parts[0] !== 'myterm' || parts[1] !== nonce) return null
  if (parts.length === 4 && parts[2] === 'exit' && /^\d{1,3}$/.test(parts[3])) {
    return { type: 'exit', code: Number(parts[3]) }
  }
  if (parts.length === 3 && parts[2] === 'missing') return { type: 'missing' }
  return null
}

/** Length of the longest suffix of `data` (after `from`) that is a proper prefix of PREFIX. */
function partialPrefixLength(data: string, from: number): number {
  const max = Math.min(PREFIX.length - 1, data.length - from)
  for (let k = max; k > 0; k--) {
    if (data.endsWith(PREFIX.slice(0, k))) return k
  }
  return 0
}

/**
 * Streaming parser that strips the launch script's OSC 6973 marker from PTY
 * output. One instance per spawn; it is one-shot and becomes a pass-through
 * after the first marker carrying its nonce. Markers with a different nonce or
 * an unexpected shape are passed through untouched (xterm ignores unknown OSCs).
 */
export class LaunchMarkerParser {
  private pending = ''
  private consumed = false

  constructor(private readonly nonce: string) {}

  public push(chunk: string): { output: string; event?: LaunchMarkerEvent } {
    if (this.consumed) return { output: chunk }

    const data = this.pending + chunk
    this.pending = ''
    let output = ''
    let from = 0

    while (from < data.length) {
      const idx = data.indexOf(PREFIX, from)
      if (idx === -1) {
        const keep = partialPrefixLength(data, from)
        output += data.slice(from, data.length - keep)
        this.pending = data.slice(data.length - keep)
        return { output }
      }

      output += data.slice(from, idx)
      const scan = scanMarker(data, idx)
      if (scan.kind === 'incomplete') {
        this.pending = data.slice(idx)
        return { output }
      }
      if (scan.kind === 'invalid') {
        output += PREFIX
        from = idx + PREFIX.length
        continue
      }

      const event = parseBody(scan.body, this.nonce)
      if (!event) {
        output += data.slice(idx, scan.end)
        from = scan.end
        continue
      }

      this.consumed = true
      output += data.slice(scan.end)
      return { output, event }
    }

    return { output }
  }

  public hasPending(): boolean {
    return this.pending.length > 0
  }

  /** Release any held bytes verbatim (on exit, or when a partial tail went stale). */
  public flush(): string {
    const held = this.pending
    this.pending = ''
    return held
  }
}

/** Map a launch event to the panel status shown in the UI. Never claims done/waiting. */
export function launchEventStatus(event: PtyLaunchEvent): { status: PanelStatus; detail: string } {
  switch (event.type) {
    case 'started':
      return { status: 'running', detail: `Running ${event.command}` }
    case 'unsupported-shell':
      return { status: 'idle', detail: 'Auto-launch needs a POSIX shell' }
    case 'missing':
      return { status: 'idle', detail: `Command "${event.command}" not found` }
    case 'exit':
      if (event.code === 130) return { status: 'idle', detail: 'Agent interrupted' }
      return { status: 'idle', detail: `Agent exited (code ${event.code})` }
  }
}
