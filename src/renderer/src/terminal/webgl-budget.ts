// Chromium allows about 16 live WebGL contexts per page and silently drops the
// oldest one beyond that. Every xterm WebGL renderer holds one context, so only
// visible panels may hold a renderer, and never more than MAX_WEBGL_CONTEXTS.
// Panels without one fall back to xterm's DOM renderer; their content lives in
// the terminal buffer either way, so nothing is lost.

export const MAX_WEBGL_CONTEXTS = 12

export interface Disposable {
  dispose(): void
}

export class WebglBudget {
  private readonly held = new Map<string, Disposable>()

  constructor(readonly max: number = MAX_WEBGL_CONTEXTS) {}

  /**
   * Gives `id` a WebGL renderer created by `create`, unless it already has one
   * or the budget is spent. `create` returns null when WebGL is unavailable.
   */
  acquire(id: string, create: () => Disposable | null): boolean {
    if (this.held.has(id)) return true
    if (this.held.size >= this.max) return false
    const renderer = create()
    if (!renderer) return false
    this.held.set(id, renderer)
    return true
  }

  /** Disposes the renderer held by `id`, if any, and frees its slot. */
  release(id: string): void {
    const renderer = this.held.get(id)
    if (!renderer) return
    this.held.delete(id)
    renderer.dispose()
  }

  has(id: string): boolean {
    return this.held.has(id)
  }

  get size(): number {
    return this.held.size
  }
}
