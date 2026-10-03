import React from 'react'
import { PanelConfig, PanelStatus } from '../../../shared/types'
import {
  Folder,
  Maximize2,
  Minimize2,
  X,
  Bot,
  Play,
  RotateCcw,
  Terminal as TerminalIcon
} from 'lucide-react'

interface PanelHeaderProps {
  panel: PanelConfig
  status?: PanelStatus
  statusDetail?: string
  isUnread?: boolean
  isMaximized: boolean
  onSelect: () => void
  onLaunchAgent?: () => void
  onRestartAgent?: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  panel,
  status = 'idle',
  statusDetail,
  isMaximized,
  onSelect,
  onLaunchAgent,
  onRestartAgent,
  onToggleMaximize,
  onClose
}) => {
  // Format short cwd (e.g. /Users/sanakulov/Developer/myterm -> myterm or Developer/myterm)
  const formatCwd = (cwd: string) => {
    if (!cwd) return '/'
    const parts = cwd.replace(/\/$/, '').split('/')
    if (parts.length > 2) {
      return parts.slice(-2).join('/')
    }
    return parts.pop() || cwd
  }

  const agentLabel =
    panel.agent === 'claude'
      ? 'Claude Code'
      : panel.agent === 'codex'
      ? 'Codex'
      : 'Shell'

  // The agent process is alive while running; waiting/done (from hooks) also
  // mean the agent is still up. Otherwise the panel sits in its fallback shell.
  const isAgentPanel = panel.agent !== 'none'
  const isAgentAlive = status === 'running' || status === 'waiting' || status === 'done'

  return (
    <div className="panel-header" onClick={onSelect}>
      <div className="panel-header-left">
        {/* Status Dot */}
        <div
          className="status-indicator"
          title={`Status: ${status}${statusDetail ? ` - ${statusDetail}` : ''}`}
        >
          <span className={`status-dot ${status}`} />
          <span style={{ textTransform: 'capitalize' }}>{status}</span>
        </div>

        {/* Agent Badge & Icon */}
        <span className={`agent-badge ${panel.agent}`} title={`Agent: ${agentLabel}`}>
          {panel.agent !== 'none' ? (
            <Bot size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
          ) : (
            <TerminalIcon size={11} style={{ display: 'inline', marginRight: 3, verticalAlign: -1 }} />
          )}
          {agentLabel}
        </span>

        {/* Project Folder Name */}
        <span
          className="panel-cwd"
          title={`Project Folder: ${panel.cwd}`}
        >
          <Folder size={11} />
          {formatCwd(panel.cwd)}
        </span>
      </div>

      <div className="panel-header-right">
        {/* Launch / Restart agent (respawns the panel shell) */}
        {isAgentPanel && !isAgentAlive && onLaunchAgent && (
          <button
            className="btn btn-sm btn-icon"
            title={`Launch ${agentLabel} (restarts this panel's shell)`}
            onClick={(e) => {
              e.stopPropagation()
              onLaunchAgent()
            }}
          >
            <Play size={12} />
          </button>
        )}
        {isAgentPanel && isAgentAlive && onRestartAgent && (
          <button
            className="btn btn-sm btn-icon"
            title={`Restart ${agentLabel}`}
            onClick={(e) => {
              e.stopPropagation()
              onRestartAgent()
            }}
          >
            <RotateCcw size={12} />
          </button>
        )}

        {/* Maximize / Restore */}
        <button
          className="btn btn-sm btn-icon"
          title={isMaximized ? 'Restore grid view (Cmd+Enter)' : 'Maximize panel (Cmd+Enter)'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleMaximize()
          }}
        >
          {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>

        {/* Close */}
        <button
          className="btn btn-sm btn-icon"
          style={{ color: '#f85149' }}
          title="Close panel (Cmd+W)"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
