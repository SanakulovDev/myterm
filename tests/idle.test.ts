import { describe, it, expect, vi, afterEach } from 'vitest'
import { whenIdle } from '../src/renderer/src/terminal/idle'

// Autosave must not starve: requestIdleCallback gets a timeout, and a timer
// backs it up when no idle callback ever arrives.

describe('whenIdle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('passes a timeout to requestIdleCallback and resolves on the callback', async () => {
    const callbacks: Array<() => void> = []
    const requestIdleCallback = vi.fn((cb: () => void, _options?: { timeout: number }) => {
      callbacks.push(cb)
      return 7
    })
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', vi.fn())

    let resolved = false
    const idle = whenIdle(500).then(() => (resolved = true))
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 })
    await Promise.resolve()
    expect(resolved).toBe(false)
    callbacks[0]()
    await idle
    expect(resolved).toBe(true)
  })

  it('resolves through the timer fallback when the idle callback never fires', async () => {
    vi.useFakeTimers()
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 3))
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)

    let resolved = false
    void whenIdle(500).then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(599)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
    expect(cancelIdleCallback).toHaveBeenCalledWith(3)
  })

  it('works without requestIdleCallback at all', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    let resolved = false
    void whenIdle(200).then(() => (resolved = true))
    await vi.advanceTimersByTimeAsync(300)
    expect(resolved).toBe(true)
  })
})
