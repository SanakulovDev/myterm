import React from 'react'
import { WorkspaceConfig, PanelStatus } from '../../../shared/types'
import {
  ChevronRightIcon,
  ChevronDownIcon,
  PlusIcon,
  FolderPlusIcon,
  WarningTriangleIcon,
  AgentIcon,
  SunMoonIcon,
  SettingsIcon
} from './Icons'

interface SidebarProps {
  workspaces: WorkspaceConfig[]
  activeWorkspaceId: string
  activePanelId: string | null
  panelStatuses: Record<string, { status: PanelStatus; detail?: string; unread?: boolean }>
  collapsedWorkspaceIds: string[]
  missingPaths?: Set<string>
  onSwitchWorkspace: (id: string) => void
  onCreateWorkspace: () => void
  onToggleCollapse: (id: string) => void
  onSelectPanel: (panelId: string, workspaceId: string) => void
  onCycleTheme?: () => void
  themeLabel?: string
  onOpenSettings?: () => void
  width?: number
}

export const Sidebar: React.FC<SidebarProps> = ({
  workspaces,
  activeWorkspaceId,
  activePanelId,
  panelStatuses,
  collapsedWorkspaceIds,
  missingPaths = new Set(),
  onSwitchWorkspace,
  onCreateWorkspace,
  onToggleCollapse,
  onSelectPanel,
  onCycleTheme,
  themeLabel = 'Theme: Auto',
  onOpenSettings,
  width = 264
}) => {
  return (
    <aside
      className="sidebar-card"
      style={{ width }}
      aria-label="Workspaces Sidebar"
    >
      {/* Header Row */}
      <div className="sidebar-header">
        <span className="sidebar-caption">WORKSPACES</span>
        <button
          type="button"
          className="sidebar-icon-btn"
          onClick={onCreateWorkspace}
          title="Add project"
          aria-label="Add project"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      {/* Project Tree */}
      <div className="sidebar-tree" role="tree">
        {workspaces.map((ws) => {
          const isCollapsed = collapsedWorkspaceIds.includes(ws.id)
          const isCurrentWorkspace = ws.id === activeWorkspaceId
          const hasMissingFolder = !ws.rootPath || missingPaths.has(ws.rootPath)

          // Unread count across this workspace's panels
          const unreadCount = ws.panels.filter((p) => panelStatuses[p.id]?.unread).length

          return (
            <div key={ws.id} className="project-group" role="treeitem" aria-expanded={!isCollapsed}>
              {/* Project Row */}
              <div
                className={`project-row ${isCurrentWorkspace ? 'active active-project' : ''}`}
                data-workspace-id={ws.id}
                onClick={() => {
                  onSwitchWorkspace(ws.id)
                }}
              >
                <button
                  type="button"
                  className="project-chevron-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCollapse(ws.id)
                  }}
                  title={isCollapsed ? 'Expand project' : 'Collapse project'}
                  aria-label={isCollapsed ? 'Expand project' : 'Collapse project'}
                >
                  {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
                </button>

                <span className="project-name" title={ws.name}>
                  {ws.name}
                </span>

                {/* Warning icon if folder not found */}
                {hasMissingFolder && (
                  <span
                    className="project-warning-icon"
                    title="Project folder not found"
                    aria-label="Project folder not found"
                  >
                    <WarningTriangleIcon size={14} />
                  </span>
                )}

                {/* Unread count pill when collapsed */}
                {isCollapsed && unreadCount > 0 && (
                  <span className="unread-pill" title={`${unreadCount} unread panel(s)`}>
                    {unreadCount}
                  </span>
                )}
              </div>

              {/* Panel Rows (when expanded) */}
              {!isCollapsed && (
                <div className="project-panels-list" role="group">
                  {ws.panels.map((panel) => {
                    const isSelected = isCurrentWorkspace && panel.id === activePanelId
                    const panelInfo = panelStatuses[panel.id]
                    const status = panelInfo?.status ?? 'idle'
                    const statusTooltip = `${status}${panelInfo?.detail ? ` · ${panelInfo.detail}` : ''}`

                    return (
                      <div
                        key={panel.id}
                        role="treeitem"
                        aria-selected={isSelected}
                        className={`panel-row ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectPanel(panel.id, ws.id)
                        }}
                      >
                        <span className="panel-agent-icon">
                          <AgentIcon agent={panel.agent} size={15} />
                        </span>

                        <span className="panel-title-text" title={panel.title}>
                          {panel.title}
                        </span>

                        <span
                          className={`sidebar-status-dot ${status}`}
                          title={statusTooltip}
                          aria-label={statusTooltip}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          type="button"
          className="add-project-btn"
          onClick={onCreateWorkspace}
          title="Add project"
        >
          <FolderPlusIcon size={14} />
          <span>Add project</span>
        </button>

        <div className="sidebar-footer-actions">
          <button
            type="button"
            className="sidebar-footer-icon-btn"
            onClick={onCycleTheme}
            title={themeLabel}
            aria-label={themeLabel}
          >
            <SunMoonIcon size={15} />
          </button>

          <button
            type="button"
            className="sidebar-footer-icon-btn"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
