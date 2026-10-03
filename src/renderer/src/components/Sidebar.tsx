import React from 'react'
import { WorkspaceConfig, PanelStatus } from '../../../shared/types'
import { Plus, LayoutGrid, Bookmark, Layers, Bot } from 'lucide-react'

interface SidebarProps {
  workspaces: WorkspaceConfig[]
  activeWorkspaceId: string
  activeWorkspace: WorkspaceConfig | null
  activePanelId: string | null
  panelStatuses: Record<string, { status: PanelStatus; detail?: string; unread?: boolean }>
  onSwitchWorkspace: (id: string) => void
  onCreateWorkspace: () => void
  onSetLayout: (rows: number, cols: number) => void
  onSelectPanel: (id: string) => void
  onOpenTemplates: () => void
}

const LAYOUT_PRESETS = [
  { label: '1×1', rows: 1, cols: 1 },
  { label: '1×2', rows: 1, cols: 2 },
  { label: '2×2', rows: 2, cols: 2 },
  { label: '2×3', rows: 2, cols: 3 },
  { label: '3×3', rows: 3, cols: 3 }
]

export const Sidebar: React.FC<SidebarProps> = ({
  workspaces,
  activeWorkspaceId,
  activeWorkspace,
  activePanelId,
  panelStatuses,
  onSwitchWorkspace,
  onCreateWorkspace,
  onSetLayout,
  onSelectPanel,
  onOpenTemplates
}) => {
  return (
    <aside className="sidebar">
      {/* Workspaces Section */}
      <div className="sidebar-section">
        <div className="sidebar-title">
          <span>Workspaces</span>
          <button
            className="btn btn-sm btn-icon"
            onClick={onCreateWorkspace}
            title="Create new workspace"
          >
            <Plus size={12} />
          </button>
        </div>
        {workspaces.map((ws) => {
          // Count unread or waiting panels in this workspace
          const unreadCount = ws.panels.filter((p) => panelStatuses[p.id]?.unread).length
          const waitingCount = ws.panels.filter(
            (p) => panelStatuses[p.id]?.status === 'waiting'
          ).length

          return (
            <div
              key={ws.id}
              className={`workspace-item ${ws.id === activeWorkspaceId ? 'active' : ''}`}
              data-workspace-id={ws.id}
              onClick={() => onSwitchWorkspace(ws.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Layers size={14} />
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    maxWidth: 120
                  }}
                >
                  {ws.name}
                </span>
              </div>

              {unreadCount > 0 ? (
                <span className="badge-count" title={`${unreadCount} panel(s) need attention`}>
                  {unreadCount}
                </span>
              ) : waitingCount > 0 ? (
                <span className="badge-count" title={`${waitingCount} panel(s) waiting`}>
                  {waitingCount}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Layout Presets Section */}
      {activeWorkspace && (
        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>Grid Layout</span>
            <LayoutGrid size={12} />
          </div>
          <div className="layout-presets">
            {LAYOUT_PRESETS.map((preset) => {
              const isActive =
                activeWorkspace.layout.rows === preset.rows &&
                activeWorkspace.layout.cols === preset.cols
              return (
                <button
                  key={preset.label}
                  className={`preset-btn ${isActive ? 'active' : ''}`}
                  onClick={() => onSetLayout(preset.rows, preset.cols)}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Panels in Active Workspace */}
      {activeWorkspace && activeWorkspace.panels.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-title">
            <span>Panels ({activeWorkspace.panels.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {activeWorkspace.panels.map((p, idx) => {
              const status = panelStatuses[p.id]?.status ?? 'idle'
              const isUnread = panelStatuses[p.id]?.unread
              const isSelected = activePanelId === p.id

              return (
                <div
                  key={p.id}
                  className={`workspace-item ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectPanel(p.id)}
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 0,
                      overflow: 'hidden'
                    }}
                  >
                    <span className={`status-dot ${status}`} />
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        color: isSelected ? 'var(--accent)' : 'inherit'
                      }}
                    >
                      {idx + 1}. {p.title}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {p.agent !== 'none' && (
                      <Bot size={11} style={{ color: 'var(--text-muted)' }} />
                    )}
                    {isUnread && <span className="status-dot waiting" />}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Templates Section */}
      <div className="sidebar-section" style={{ marginTop: 'auto' }}>
        <button
          className="btn"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          onClick={onOpenTemplates}
        >
          <Bookmark size={13} />
          <span>Templates</span>
        </button>
      </div>
    </aside>
  )
}
