import React from 'react'
import { WorkspaceConfig, PanelConfig, PanelStatus } from '../../../shared/types'
import { placePanels } from '../../../shared/layout'
import { TerminalPanel } from './TerminalPanel'
import { PlusIcon } from './Icons'

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
  onUpdatePanel
}) => {
  const { layout = { mode: 'stack', rows: 1, cols: 2 }, panels, name } = workspace

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

  // Calculate placement based on stack or grid mode
  const placement = placePanels(panels.length, layout)

  const isAnyMaximized = Boolean(maximizedPanelId)

  const wrapperStyle: React.CSSProperties = isAnyMaximized
    ? {
        display: 'grid',
        gridTemplateRows: '1fr',
        gridTemplateColumns: '1fr',
        height: '100%',
        width: '100%'
      }
    : {
        display: 'grid',
        gridTemplateRows: `repeat(${placement.rows}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${placement.tracks}, minmax(0, 1fr))`,
        gap: 'var(--gap)',
        height: '100%',
        width: '100%'
      }

  return (
    <div className="workspace-main-area">
      <div className="panels-grid-wrapper" style={wrapperStyle}>
        {panels.map((panel, index) => {
          const isMaximized = maximizedPanelId === panel.id
          const isHidden = isAnyMaximized && !isMaximized
          const cell = placement.cells[index]

          const cellStyle: React.CSSProperties = isAnyMaximized
            ? isMaximized
              ? { gridRow: '1', gridColumn: '1', height: '100%', width: '100%' }
              : { display: 'none' }
            : cell
              ? {
                  gridRow: `${cell.row}`,
                  gridColumn: `${cell.colStart} / ${cell.colEnd}`,
                  minWidth: 0,
                  minHeight: 0
                }
              : {}

          return (
            <div key={panel.id} style={cellStyle} className="panel-grid-cell">
              <TerminalPanel
                panel={panel}
                projectName={name}
                isActive={!isHidden && activePanelId === panel.id}
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
