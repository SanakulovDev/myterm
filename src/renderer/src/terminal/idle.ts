// How long background work waits for an idle moment before it runs anyway.
export const IDLE_TIMEOUT_MS = 1000

/**
 * Resolves at the next idle moment, and at the latest after `timeoutMs`.
 * requestIdleCallback alone can starve (a page that never goes idle), so it
 * gets a timeout, and a timer backs it up in case it never fires at all.
 */
export function whenIdle(timeoutMs = IDLE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    let handle: number | undefined
    const done = (): void => {
      clearTimeout(fallback)
      if (handle !== undefined) cancelIdleCallback(handle)
      resolve()
    }
    const fallback = setTimeout(done, timeoutMs + 100)
    if (typeof requestIdleCallback === 'function') {
      handle = requestIdleCallback(done, { timeout: timeoutMs })
    }
  })
}
