import { describe, it, expect } from 'vitest'
import {
  placePanels,
  folderName,
  GRID_PRESETS,
  DEFAULT_LAYOUT,
  getOrInitFractions,
  adjustFractions
} from '../src/shared/layout'

describe('layout placement', () => {
  it('handles empty panel list', () => {
    const res = placePanels(0, { mode: 'stack', cols: 2 })
    expect(res.rows).toBe(0)
    expect(res.cells).toHaveLength(0)
  })

  it('places panels vertically in stack mode', () => {
    const res = placePanels(3, { mode: 'stack', cols: 2 })
    expect(res.rows).toBe(3)
    expect(res.tracks).toBe(1)
    expect(res.cells).toEqual([
      { row: 1, colStart: 1, colEnd: 2 },
      { row: 2, colStart: 1, colEnd: 2 },
      { row: 3, colStart: 1, colEnd: 2 }
    ])
  })

  it('places panels in grid mode with full rows', () => {
    const res = placePanels(4, { mode: 'grid', cols: 2 })
    expect(res.rows).toBe(2)
    expect(res.tracks).toBe(2)
    expect(res.cells).toEqual([
      { row: 1, colStart: 1, colEnd: 2 },
      { row: 1, colStart: 2, colEnd: 3 },
      { row: 2, colStart: 1, colEnd: 2 },
      { row: 2, colStart: 2, colEnd: 3 }
    ])
  })

  it('stretches panels across last row when count is not a multiple of cols', () => {
    const res = placePanels(3, { mode: 'grid', cols: 2 })
    expect(res.rows).toBe(2)
    // 2 in row 1, 1 in row 2 -> tracks = 2
    expect(res.tracks).toBe(2)
    expect(res.cells[0]).toEqual({ row: 1, colStart: 1, colEnd: 2 })
    expect(res.cells[1]).toEqual({ row: 1, colStart: 2, colEnd: 3 })
    // Last row has 1 panel, spanning all 2 tracks
    expect(res.cells[2]).toEqual({ row: 2, colStart: 1, colEnd: 3 })
  })

  it('extracts folder name accurately', () => {
    expect(folderName('/Users/test/Developer/myterm/')).toBe('myterm')
    expect(folderName('/Users/test/Developer/myterm')).toBe('myterm')
    expect(folderName('/')).toBe('/')
  })

  it('has valid presets', () => {
    expect(GRID_PRESETS).toHaveLength(5)
    expect(DEFAULT_LAYOUT.mode).toBe('stack')
  })

  it('initializes and recovers fractions with getOrInitFractions', () => {
    expect(getOrInitFractions(undefined, 3)).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(getOrInitFractions([0.2, 0.8], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]) // wrong count
    expect(getOrInitFractions([0.3, 0.7], 2)).toEqual([0.3, 0.7])
  })

  it('adjusts fractions cleanly with minimum pixel clamping', () => {
    // Total height 1000px, min 120px (min fraction 0.12)
    const initial = [0.5, 0.5]
    // Move divider down by 100px (+0.1)
    const res1 = adjustFractions(initial, 0, 100, 1000, 120)
    expect(res1[0]).toBeCloseTo(0.6)
    expect(res1[1]).toBeCloseTo(0.4)

    // Move divider down by 450px (+0.45) -> second panel would be 0.05, clamped to 0.12
    const res2 = adjustFractions(initial, 0, 450, 1000, 120)
    expect(res2[1]).toBeCloseTo(0.12)
    expect(res2[0]).toBeCloseTo(0.88)

    // Move divider up by 450px (-0.45) -> first panel clamped to 0.12
    const res3 = adjustFractions(initial, 0, -450, 1000, 120)
    expect(res3[0]).toBeCloseTo(0.12)
    expect(res3[1]).toBeCloseTo(0.88)
  })
})
