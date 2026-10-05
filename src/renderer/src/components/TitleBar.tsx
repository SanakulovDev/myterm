import React from 'react'
import { SidebarToggleIcon, LayoutIcon, BellIcon, SettingsIcon } from './Icons'

interface TitleBarProps {
  projectName?: string
  panelName?: string
  isSidebarVisible: boolean
  onToggleSidebar: () => void
  onToggleLayout: (e: React.MouseEvent) => void
  isLayoutOpen?: boolean
  onOpenNotifications?: () => void
  hasAttention?: boolean
  onOpenSettings?: () => void
}

export const TitleBar: React.FC<TitleBarProps> = ({
  projectName = 'Main Workspace',
  panelName,
  isSidebarVisible,
  onToggleSidebar,
  onToggleLayout,
  isLayoutOpen,
  onOpenNotifications,
  hasAttention,
  onOpenSettings
}) => {
  return (
    <header className="titlebar-chrome" role="banner">
      <div className="titlebar-left">
        {/* Traffic lights gap */}
        <div className="traffic-lights-spacer" aria-hidden="true" />
        <span className="app-chrome-title">Agent Terminal</span>
        <button
          type="button"
          className={`chrome-icon-btn ${!isSidebarVisible ? 'active' : ''}`}
          onClick={onToggleSidebar}
          title={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          aria-label={isSidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
        >
          <SidebarToggleIcon size={16} />
        </button>
      </div>

      <div className="titlebar-center">
        <div className="chrome-breadcrumb">
          <span className="breadcrumb-project">{projectName}</span>
          {panelName && (
            <>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-panel">{panelName}</span>
            </>
          )}
        </div>
      </div>

      <div className="titlebar-right">
        <button
          type="button"
          className={`chrome-icon-btn ${isLayoutOpen ? 'active' : ''}`}
          onClick={onToggleLayout}
          title="Change layout"
          aria-label="Layout"
          aria-expanded={isLayoutOpen}
        >
          <LayoutIcon size={16} />
        </button>

        <button
          type="button"
          className="chrome-icon-btn notifications-btn"
          onClick={onOpenNotifications}
          title={hasAttention ? 'Notifications (attention needed)' : 'Notifications'}
          aria-label="Notifications"
        >
          <BellIcon size={16} />
          {hasAttention && <span className="attention-dot" aria-label="Action required" />}
        </button>

        <button
          type="button"
          className="chrome-icon-btn"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    </header>
  )
}
