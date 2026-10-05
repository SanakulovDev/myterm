import type { UiState, WorkspaceLayout } from './types'

export const DEFAULT_UI_STATE: UiState = {
  sidebarVisible: true,
  sidebarWidth: 264,
  collapsedWorkspaceIds: [],
  rightSlotWidth: 360
}

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 400

/** The grid presets of the Layout popover, as rows x columns. */
export const GRID_PRESETS: readonly { rows: number; cols: number }[] = [
  { rows: 1, cols: 1 },
  { rows: 1, cols: 2 },
  { rows: 2, cols: 2 },
  { rows: 2, cols: 3 },
  { rows: 3, cols: 3 }
]

export const DEFAULT_LAYOUT: WorkspaceLayout = { mode: 'stack', rows: 1, cols: 2 }

/** Where one panel sits: 1-based CSS grid lines. */
export interface CellPlacement {
  row: number
  colStart: number
  colEnd: number
}

export interface GridPlacement {
  rows: number
  /** Column tracks; a full-width row spans all of them. */
  tracks: number
  cells: CellPlacement[]
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Places `count` panels row by row, `cols` per row. A shorter last row
 * stretches its panels over the whole width, and more panels than the preset
 * holds add rows. Stack mode is one column.
 */
export function placePanels(count: number, layout: Pick<WorkspaceLayout, 'mode' | 'cols'>): GridPlacement {
  if (count <= 0) return { rows: 0, tracks: 1, cells: [] }
  const perRow = layout.mode === 'stack' ? 1 : Math.max(1, Math.min(Math.floor(layout.cols) || 1, count))
  const rows = Math.ceil(count / perRow)
  const lastRow = count - (rows - 1) * perRow
  // Enough tracks that both a full row and the last row divide them evenly.
  const tracks = (perRow * lastRow) / gcd(perRow, lastRow)
  const cells: CellPlacement[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow)
    const inRow = row === rows - 1 ? lastRow : perRow
    const span = tracks / inRow
    const index = i - row * perRow
    cells.push({ row: row + 1, colStart: index * span + 1, colEnd: (index + 1) * span + 1 })
  }
  return { rows, tracks, cells }
}

/** The last path segment, for a project named after its folder. */
export function folderName(folder: string): string {
  const trimmed = folder.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed || '/'
}
