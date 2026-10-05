import React from 'react'
import { PanelConfig, PanelStatus } from '../../../shared/types'
import { isAgentPanel, agentLabel } from '../../../shared/agents'
import {
  AgentIcon,
  SparkleIcon,
  MoreIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
  CloseIcon,
  PlayIcon,
  RotateCcwIcon
} from './Icons'

interface PanelHeaderProps {
  panel: PanelConfig
  projectName?: string
  status?: PanelStatus
  statusDetail?: string
  isUnread?: boolean
  isMaximized: boolean
  onSelect: () => void
  onOpenMenu?: (e: React.MouseEvent) => void
  onToggleMaximize: () => void
  onAddPanel?: () => void
  onClose: () => void
  onLaunchAgent?: () => void
  onRestartAgent?: () => void
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  panel,
  projectName = '',
  status = 'idle',
  statusDetail,
  isMaximized,
  onSelect,
  onOpenMenu,
  onToggleMaximize,
  onAddPanel,
  onClose,
  onLaunchAgent,
  onRestartAgent
}) => {
  const isAgent = isAgentPanel(panel)
  const label = agentLabel(panel)
  const isAgentAlive = status === 'running' || status === 'waiting' || status === 'done'
  const isAutoNamed = panel.autoName !== false && panel.agent !== 'none'
  const statusTooltip = `${status}${statusDetail ? ` · ${statusDetail}` : ''}`

  return (
    <div className="panel-header-bar panel-header" onClick={onSelect}>
      <div className="panel-header-left">
        {/* Agent Icon (15px) */}
        <span className="panel-header-agent-icon" aria-hidden="true">
          <AgentIcon agent={panel.agent} size={15} />
        </span>

        {/* Panel Name (13px/500, ellipsis) */}
        <span className="panel-header-name" title={panel.title}>
          {panel.title}
        </span>

        {/* Sparkle icon when auto-named (13px, tooltip "Auto-named") */}
        {isAutoNamed && (
          <span className="auto-named-sparkle" title="Auto-named" aria-label="Auto-named">
            <SparkleIcon size={13} />
          </span>
        )}

        {/* Project Name (13px, caption color) */}
        {projectName && (
          <span className="panel-header-project-name" title={projectName}>
            {projectName}
          </span>
        )}

        {/* 8px Status Dot (tooltip with status text) */}
        <span
          className={`panel-header-status-dot ${status}`}
          title={statusTooltip}
          aria-label={statusTooltip}
        />
      </div>

      {/* Spacer */}
      <div className="panel-header-spacer" />

      {/* 26px Action Buttons (never shrink) */}
      <div className="panel-header-actions" onClick={(e) => e.stopPropagation()}>
        {/* Launch / Restart agent button if configured */}
        {isAgent && !isAgentAlive && onLaunchAgent && (
          <button
            type="button"
            className="panel-action-btn launch-btn"
            title={`Launch ${label} (restarts this panel's shell)`}
            aria-label={`Launch ${label}`}
            onClick={onLaunchAgent}
          >
            <PlayIcon size={14} />
          </button>
        )}
        {isAgent && isAgentAlive && onRestartAgent && (
          <button
            type="button"
            className="panel-action-btn restart-btn"
            title={`Restart ${label} (restarts this panel's shell)`}
            aria-label={`Restart ${label}`}
            onClick={onRestartAgent}
          >
            <RotateCcwIcon size={14} />
          </button>
        )}

        <button
          type="button"
          className="panel-action-btn"
          onClick={onOpenMenu}
          title="Panel actions"
          aria-label="Panel menu"
        >
          <MoreIcon size={14} />
        </button>

        <button
          type="button"
          className="panel-action-btn"
          onClick={onToggleMaximize}
          title={isMaximized ? 'Restore panel' : 'Maximize panel'}
          aria-label={isMaximized ? 'Restore panel' : 'Maximize panel'}
        >
          {isMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
        </button>

        {onAddPanel && (
          <button
            type="button"
            className="panel-action-btn"
            onClick={onAddPanel}
            title="Add panel (Cmd+N)"
            aria-label="Add panel (Cmd+N)"
            data-open-new-panel
          >
            <PlusIcon size={14} />
          </button>
        )}

        <button
          type="button"
          className="panel-action-btn close-btn"
          onClick={onClose}
          title="Close panel"
          aria-label="Close panel"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  )
}
