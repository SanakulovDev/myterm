import { describe, it, expect, vi } from 'vitest'
import { WebglBudget, MAX_WEBGL_CONTEXTS } from '../src/renderer/src/terminal/webgl-budget'

const renderer = () => ({ dispose: vi.fn() })

describe('WebglBudget', () => {
  it('stays below the ~16 contexts Chromium allows per page', () => {
    expect(MAX_WEBGL_CONTEXTS).toBeLessThan(16)
    expect(new WebglBudget().max).toBe(MAX_WEBGL_CONTEXTS)
  })

  it('grants renderers up to the cap and refuses beyond it without creating one', () => {
    const budget = new WebglBudget(2)
    expect(budget.acquire('a', renderer)).toBe(true)
    expect(budget.acquire('b', renderer)).toBe(true)
    const create = vi.fn(renderer)
    expect(budget.acquire('c', create)).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(budget.size).toBe(2)
  })

  it('does not create a second renderer for the same panel', () => {
    const budget = new WebglBudget(2)
    const create = vi.fn(renderer)
    budget.acquire('a', create)
    budget.acquire('a', create)
    expect(create).toHaveBeenCalledTimes(1)
    expect(budget.size).toBe(1)
  })

  it('release disposes the renderer and frees the slot', () => {
    const budget = new WebglBudget(1)
    const held = renderer()
    budget.acquire('a', () => held)
    budget.release('a')
    expect(held.dispose).toHaveBeenCalledTimes(1)
    expect(budget.has('a')).toBe(false)
    expect(budget.acquire('b', renderer)).toBe(true)
    budget.release('nope')
  })

  it('does not count a panel whose WebGL renderer could not be created', () => {
    const budget = new WebglBudget(2)
    expect(budget.acquire('a', () => null)).toBe(false)
    expect(budget.size).toBe(0)
  })
})
