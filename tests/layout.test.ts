import { describe, it, expect } from 'vitest'
import { placePanels, folderName, GRID_PRESETS, DEFAULT_LAYOUT } from '../src/shared/layout'

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
})
