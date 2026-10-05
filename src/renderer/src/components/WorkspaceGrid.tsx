import React, { useRef, useCallback } from 'react'
import { WorkspaceConfig, PanelConfig, PanelStatus, WorkspaceLayout } from '../../../shared/types'
import {
  placePanels,
  getOrInitFractions,
  adjustFractions,
  PANEL_MIN_WIDTH,
  PANEL_MIN_HEIGHT,
  DIVIDER_SIZE
} from '../../../shared/layout'
import { TerminalPanel } from './TerminalPanel'
import { ResizeDivider } from './ResizeDivider'
import { PlusIcon } from './Icons'
import { terminalRegistry } from '../terminal/terminals'

interface WorkspaceGridProps {
  workspace: WorkspaceConfig
  activePanelId: string | null
  maximizedPanelId: string | null
  panelStatuses: Record<string, { status: PanelStatus; detail?: string; unread?: boolean }>
  searchPanelId: string | null
  onSelectPanel: (id: string) => void
  onToggleMaximize: (id?: string) => void
  onClosePanel: (id: string) => void
  onLaunchAgent?: (id: string) => void
  onRestartAgent?: (id: string) => void
  onToggleSearch: (id: string) => void
  onUpdatePanel?: (id: string, updates: Partial<PanelConfig>) => void
  onAddNewPanel: () => void
  onOpenPanelMenu?: (panelId: string, e: React.MouseEvent) => void
  onUpdateLayout?: (layoutUpdates: Partial<WorkspaceLayout>) => void
}

export const WorkspaceGrid: React.FC<WorkspaceGridProps> = ({
  workspace,
  activePanelId,
  maximizedPanelId,
  panelStatuses,
  searchPanelId,
  onSelectPanel,
  onToggleMaximize,
  onClosePanel,
  onLaunchAgent,
  onRestartAgent,
  onToggleSearch,
  onAddNewPanel,
  onOpenPanelMenu,
  onUpdatePanel,
  onUpdateLayout
}) => {
  const { layout = { mode: 'stack', rows: 1, cols: 2 }, panels, name } = workspace
  const containerRef = useRef<HTMLDivElement>(null)

  const isAnyMaximized = Boolean(maximizedPanelId)

  const handleResizeEnd = useCallback(() => {
    terminalRegistry.fitAll()
  }, [])

  // Stack Mode handlers
  const handleResizeStack = useCallback(
    (index: number, deltaPx: number) => {
      if (!containerRef.current) return
      const totalH = containerRef.current.clientHeight
      const availableH = totalH - (panels.length - 1) * DIVIDER_SIZE
      const currentSizes = getOrInitFractions(layout.stackRowSizes, panels.length)
      const nextSizes = adjustFractions(currentSizes, index, deltaPx, availableH, PANEL_MIN_HEIGHT)
      onUpdateLayout?.({ stackRowSizes: nextSizes })
    },
    [panels.length, layout.stackRowSizes, onUpdateLayout]
  )

  const handleResetStack = useCallback(() => {
    onUpdateLayout?.({ stackRowSizes: Array(panels.length).fill(1 / panels.length) })
    terminalRegistry.fitAll()
  }, [panels.length, onUpdateLayout])

  // Grid Mode handlers
  const placement = placePanels(panels.length, layout)

  const handleResizeGridRow = useCallback(
    (rowIndex: number, deltaPx: number) => {
      if (!containerRef.current) return
      const totalH = containerRef.current.clientHeight
      const availableH = totalH - (placement.rows - 1) * DIVIDER_SIZE
      const currentSizes = getOrInitFractions(layout.gridRowSizes, placement.rows)
      const nextSizes = adjustFractions(currentSizes, rowIndex, deltaPx, availableH, PANEL_MIN_HEIGHT)
      onUpdateLayout?.({ gridRowSizes: nextSizes })
    },
    [placement.rows, layout.gridRowSizes, onUpdateLayout]
  )

  const handleResetGridRows = useCallback(() => {
    onUpdateLayout?.({ gridRowSizes: Array(placement.rows).fill(1 / placement.rows) })
    terminalRegistry.fitAll()
  }, [placement.rows, onUpdateLayout])

  const handleResizeGridCol = useCallback(
    (colIndex: number, deltaPx: number) => {
      if (!containerRef.current) return
      const totalW = containerRef.current.clientWidth
      const availableW = totalW - (placement.tracks - 1) * DIVIDER_SIZE
      const currentSizes = getOrInitFractions(layout.gridColSizes, placement.tracks)
      const nextSizes = adjustFractions(currentSizes, colIndex, deltaPx, availableW, PANEL_MIN_WIDTH)
      onUpdateLayout?.({ gridColSizes: nextSizes })
    },
    [placement.tracks, layout.gridColSizes, onUpdateLayout]
  )

  const handleResetGridCols = useCallback(() => {
    onUpdateLayout?.({ gridColSizes: Array(placement.tracks).fill(1 / placement.tracks) })
    terminalRegistry.fitAll()
  }, [placement.tracks, onUpdateLayout])

  if (panels.length === 0) {
    return (
      <div className="workspace-empty-container">
        <div className="empty-panel-card">
          <p className="empty-card-subtitle">No panels open in this workspace.</p>
          <button type="button" className="btn btn-primary" onClick={onAddNewPanel}>
            <PlusIcon size={14} />
            <span>New Panel</span>
          </button>
        </div>
      </div>
    )
  }

  // When any panel is maximized, it fills 100% of the area; others remain mounted but hidden
  if (isAnyMaximized) {
    return (
      <div className="workspace-main-area">
        <div style={{ height: '100%', width: '100%', position: 'relative' }}>
          {panels.map((panel) => {
            const isMaximized = maximizedPanelId === panel.id
            const isHidden = !isMaximized
            return (
              <div
                key={panel.id}
                style={isHidden ? { display: 'none' } : { height: '100%', width: '100%' }}
                className="panel-grid-cell"
              >
                <TerminalPanel
                  panel={panel}
                  projectName={name}
                  isActive={isMaximized}
                  isMaximized={isMaximized}
                  isHidden={isHidden}
                  isUnread={panelStatuses[panel.id]?.unread}
                  status={panelStatuses[panel.id]?.status ?? 'idle'}
                  statusDetail={panelStatuses[panel.id]?.detail}
                  isSearchOpen={searchPanelId === panel.id}
                  onLaunchAgent={onLaunchAgent && (() => onLaunchAgent(panel.id))}
                  onRestartAgent={onRestartAgent && (() => onRestartAgent(panel.id))}
                  onSelect={() => onSelectPanel(panel.id)}
                  onToggleMaximize={() => onToggleMaximize(panel.id)}
                  onClose={() => onClosePanel(panel.id)}
                  onAddPanel={onAddNewPanel}
                  onOpenMenu={onOpenPanelMenu ? (e) => onOpenPanelMenu(panel.id, e) : undefined}
                  onToggleSearch={() => onToggleSearch(panel.id)}
                  onUpdate={onUpdatePanel ? (updates) => onUpdatePanel(panel.id, updates) : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Stack Mode (default): panels vertically stacked, full width, separated by 12px horizontal dividers
  if (layout.mode === 'stack') {
    const stackSizes = getOrInitFractions(layout.stackRowSizes, panels.length)
    return (
      <div className="workspace-main-area" ref={containerRef}>
        <div
          className="panels-stack-wrapper"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            overflow: 'hidden'
          }}
        >
          {panels.map((panel, idx) => (
            <React.Fragment key={panel.id}>
              <div
                className="panel-grid-cell stack-panel-cell"
                style={{
                  flex: `${stackSizes[idx] ?? 1} 1 0%`,
                  minHeight: `${PANEL_MIN_HEIGHT}px`,
                  minWidth: 0,
                  overflow: 'hidden'
                }}
              >
                <TerminalPanel
                  panel={panel}
                  projectName={name}
                  isActive={activePanelId === panel.id}
                  isMaximized={false}
                  isUnread={panelStatuses[panel.id]?.unread}
                  status={panelStatuses[panel.id]?.status ?? 'idle'}
                  statusDetail={panelStatuses[panel.id]?.detail}
                  isSearchOpen={searchPanelId === panel.id}
                  onLaunchAgent={onLaunchAgent && (() => onLaunchAgent(panel.id))}
                  onRestartAgent={onRestartAgent && (() => onRestartAgent(panel.id))}
                  onSelect={() => onSelectPanel(panel.id)}
                  onToggleMaximize={() => onToggleMaximize(panel.id)}
                  onClose={() => onClosePanel(panel.id)}
                  onAddPanel={onAddNewPanel}
                  onOpenMenu={onOpenPanelMenu ? (e) => onOpenPanelMenu(panel.id, e) : undefined}
                  onToggleSearch={() => onToggleSearch(panel.id)}
                  onUpdate={onUpdatePanel ? (updates) => onUpdatePanel(panel.id, updates) : undefined}
                />
              </div>
              {idx < panels.length - 1 && (
                <ResizeDivider
                  orientation="horizontal"
                  onResize={(delta) => handleResizeStack(idx, delta)}
                  onResizeEnd={handleResizeEnd}
                  onReset={handleResetStack}
                  label={`Resize between panel ${idx + 1} and ${idx + 2}`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    )
  }

  // Grid Mode: rows and columns with whole row/col dividers
  const gridRowSizes = getOrInitFractions(layout.gridRowSizes, placement.rows)
  const gridColSizes = getOrInitFractions(layout.gridColSizes, placement.tracks)

  const gridTemplateRows =
    placement.rows <= 1
      ? '1fr'
      : gridRowSizes.map((f) => `minmax(${PANEL_MIN_HEIGHT}px, ${f}fr)`).join(` ${DIVIDER_SIZE}px `)

  const gridTemplateColumns =
    placement.tracks <= 1
      ? '1fr'
      : gridColSizes.map((f) => `minmax(${PANEL_MIN_WIDTH}px, ${f}fr)`).join(` ${DIVIDER_SIZE}px `)

  return (
    <div className="workspace-main-area" ref={containerRef}>
      <div
        className="panels-grid-wrapper"
        style={{
          display: 'grid',
          gridTemplateRows,
          gridTemplateColumns,
          height: '100%',
          width: '100%',
          position: 'relative'
        }}
      >
        {panels.map((panel, index) => {
          const cell = placement.cells[index]
          const cellStyle: React.CSSProperties = {
            gridRow: `${2 * cell.row - 1} / ${2 * cell.row}`,
            gridColumn: `${2 * cell.colStart - 1} / ${2 * (cell.colEnd - 1)}`,
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden'
          }

          return (
            <div key={panel.id} style={cellStyle} className="panel-grid-cell">
              <TerminalPanel
                panel={panel}
                projectName={name}
                isActive={activePanelId === panel.id}
                isMaximized={false}
                isUnread={panelStatuses[panel.id]?.unread}
                status={panelStatuses[panel.id]?.status ?? 'idle'}
                statusDetail={panelStatuses[panel.id]?.detail}
                isSearchOpen={searchPanelId === panel.id}
                onLaunchAgent={onLaunchAgent && (() => onLaunchAgent(panel.id))}
                onRestartAgent={onRestartAgent && (() => onRestartAgent(panel.id))}
                onSelect={() => onSelectPanel(panel.id)}
                onToggleMaximize={() => onToggleMaximize(panel.id)}
                onClose={() => onClosePanel(panel.id)}
                onAddPanel={onAddNewPanel}
                onOpenMenu={onOpenPanelMenu ? (e) => onOpenPanelMenu(panel.id, e) : undefined}
                onToggleSearch={() => onToggleSearch(panel.id)}
                onUpdate={onUpdatePanel ? (updates) => onUpdatePanel(panel.id, updates) : undefined}
              />
            </div>
          )
        })}

        {/* Horizontal row dividers (whole row across all columns) */}
        {placement.rows > 1 &&
          Array.from({ length: placement.rows - 1 }).map((_, r) => (
            <ResizeDivider
              key={`h-div-${r}`}
              orientation="horizontal"
              style={{
                gridRow: `${2 * (r + 1)} / ${2 * (r + 1) + 1}`,
                gridColumn: '1 / -1',
                zIndex: 5
              }}
              onResize={(delta) => handleResizeGridRow(r, delta)}
              onResizeEnd={handleResizeEnd}
              onReset={handleResetGridRows}
              label={`Resize between row ${r + 1} and ${r + 2}`}
            />
          ))}

        {/* Vertical column dividers (whole column across all rows) */}
        {placement.tracks > 1 &&
          Array.from({ length: placement.tracks - 1 }).map((_, c) => (
            <ResizeDivider
              key={`v-div-${c}`}
              orientation="vertical"
              style={{
                gridColumn: `${2 * (c + 1)} / ${2 * (c + 1) + 1}`,
                gridRow: '1 / -1',
                zIndex: 5
              }}
              onResize={(delta) => handleResizeGridCol(c, delta)}
              onResizeEnd={handleResizeEnd}
              onReset={handleResetGridCols}
              label={`Resize between column ${c + 1} and ${c + 2}`}
            />
          ))}
      </div>
    </div>
  )
}
