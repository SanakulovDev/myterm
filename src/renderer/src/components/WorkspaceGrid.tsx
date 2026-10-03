import React from 'react'
import { WorkspaceConfig, PanelConfig, PanelStatus } from '../../../shared/types'
import { TerminalPanel } from './TerminalPanel'
import { Plus, TerminalSquare } from 'lucide-react'

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
  onAddNewPanel
}) => {
  const { layout, panels } = workspace

  if (panels.length === 0) {
    return (
      <div className="workspace-container">
        <div className="empty-state">
          <TerminalSquare size={48} strokeWidth={1.5} />
          <h3>No panels in this workspace</h3>
          <p>Add a new terminal panel to get started running agents or commands.</p>
          <button className="btn btn-primary" onClick={onAddNewPanel}>
            <Plus size={14} />
            New Panel
          </button>
        </div>
      </div>
    )
  }

  // Calculate grid template
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `repeat(${layout.cols || 1}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${layout.rows || 1}, minmax(0, 1fr))`
  }

  return (
    <div className="workspace-container">
      <div className="grid-wrapper" style={gridStyle}>
        {panels.map((panel) => {
          const isMaximized = maximizedPanelId === panel.id
          // Panels hidden behind a maximized one stay mounted but release their
          // WebGL renderer. Remounts are harmless: the terminal registry keeps
          // every session (and its PTY) until the panel is closed.
          const isHidden = !!maximizedPanelId && !isMaximized

          return (
            <TerminalPanel
              key={panel.id}
              panel={panel}
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
              onToggleSearch={() => onToggleSearch(panel.id)}
            />
          )
        })}
      </div>
    </div>
  )
}
