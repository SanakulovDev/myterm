import { describe, it, expect } from 'vitest'
import { LaunchMarkerParser, launchEventStatus } from '../src/main/launch-marker'

const NONCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const exitMarker = (code: number, nonce = NONCE, end = '\x07'): string =>
  `\x1b]6973;myterm;${nonce};exit;${code}${end}`
const missingMarker = `\x1b]6973;myterm;${NONCE};missing\x07`

function feed(parser: LaunchMarkerParser, chunks: string[]) {
  let output = ''
  const events = []
  for (const chunk of chunks) {
    const result = parser.push(chunk)
    output += result.output
    if (result.event) events.push(result.event)
  }
  output += parser.flush()
  return { output, events }
}

describe('LaunchMarkerParser', () => {
  it('strips an exit marker (BEL) and reports the code', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const result = parser.push(`agent bye\r\n${exitMarker(3)}% `)
    expect(result.output).toBe('agent bye\r\n% ')
    expect(result.event).toEqual({ type: 'exit', code: 3 })
  })

  it('accepts the ST (ESC \\) terminator', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const result = parser.push(`x${exitMarker(0, NONCE, '\x1b\\')}y`)
    expect(result.output).toBe('xy')
    expect(result.event).toEqual({ type: 'exit', code: 0 })
  })

  it('strips the missing-command marker', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const result = parser.push(`banner\n${missingMarker}$ `)
    expect(result.output).toBe('banner\n$ ')
    expect(result.event).toEqual({ type: 'missing' })
  })

  it('handles a marker split at every possible position', () => {
    const text = `before ${exitMarker(130)} after`
    for (let i = 1; i < text.length; i++) {
      const { output, events } = feed(new LaunchMarkerParser(NONCE), [text.slice(0, i), text.slice(i)])
      expect(output).toBe('before  after')
      expect(events).toEqual([{ type: 'exit', code: 130 }])
    }
  })

  it('handles a marker delivered one character at a time', () => {
    const text = `a${missingMarker}b`
    const { output, events } = feed(new LaunchMarkerParser(NONCE), text.split(''))
    expect(output).toBe('ab')
    expect(events).toEqual([{ type: 'missing' }])
  })

  it('passes markers with another nonce through without an event', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const forged = exitMarker(0, 'ffffffffffffffffffffffffffffffff')
    const result = parser.push(`x${forged}y`)
    expect(result.output).toBe(`x${forged}y`)
    expect(result.event).toBeUndefined()
  })

  it('passes malformed markers through', () => {
    for (const body of [`myterm;${NONCE};exit;abc`, `myterm;${NONCE};exit`, `myterm;${NONCE};boom`]) {
      const parser = new LaunchMarkerParser(NONCE)
      const text = `\x1b]6973;${body}\x07`
      expect(parser.push(text)).toEqual({ output: text })
    }
  })

  it('releases a 6973 OSC with unexpected characters immediately', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const text = '\x1b]6973;hello world\x07'
    expect(parser.push(text).output).toBe(text)
    expect(parser.hasPending()).toBe(false)
  })

  it('holds a partial prefix and releases it when it is not a marker', () => {
    const parser = new LaunchMarkerParser(NONCE)
    expect(parser.push('abc\x1b')).toEqual({ output: 'abc' })
    expect(parser.hasPending()).toBe(true)
    expect(parser.push('[31mred')).toEqual({ output: '\x1b[31mred' })
    expect(parser.hasPending()).toBe(false)
  })

  it('leaves other escape sequences untouched', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const text = '\x1b]0;title\x07\x1b]697;x\x07\x1b[1;33mhi\x1b[0m'
    expect(parser.push(text)).toEqual({ output: text })
  })

  it('caps how much it holds for an unterminated marker', () => {
    const parser = new LaunchMarkerParser(NONCE)
    const text = '\x1b]6973;' + 'a'.repeat(300)
    const result = parser.push(text)
    expect(result.output).toBe(text)
    expect(parser.hasPending()).toBe(false)
  })

  it('is one-shot: a second marker passes through', () => {
    const parser = new LaunchMarkerParser(NONCE)
    expect(parser.push(exitMarker(0)).event).toEqual({ type: 'exit', code: 0 })
    const again = parser.push(exitMarker(1))
    expect(again).toEqual({ output: exitMarker(1) })
  })

  it('flush returns held bytes verbatim', () => {
    const parser = new LaunchMarkerParser(NONCE)
    expect(parser.push('\x1b]6973;myterm;').output).toBe('')
    expect(parser.flush()).toBe('\x1b]6973;myterm;')
    expect(parser.hasPending()).toBe(false)
  })
})

describe('launchEventStatus', () => {
  it('maps launch events to running/idle only', () => {
    expect(launchEventStatus({ type: 'started', command: 'claude' })).toEqual({
      status: 'running',
      detail: 'Running claude'
    })
    expect(launchEventStatus({ type: 'exit', code: 0, command: 'claude' })).toEqual({
      status: 'idle',
      detail: 'Agent exited (code 0)'
    })
    expect(launchEventStatus({ type: 'exit', code: 2, command: 'claude' }).status).toBe('idle')
    expect(launchEventStatus({ type: 'exit', code: 130, command: 'claude' })).toEqual({
      status: 'idle',
      detail: 'Agent interrupted'
    })
    expect(launchEventStatus({ type: 'missing', command: 'claude' })).toEqual({
      status: 'idle',
      detail: 'Command "claude" not found'
    })
    expect(launchEventStatus({ type: 'unsupported-shell', shell: '/bin/fish' }).status).toBe('idle')
  })
})
