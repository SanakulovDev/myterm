import React, { useState, useEffect } from 'react'
import { PanelConfig, AgentKind, AgentSettings } from '../../../shared/types'
import { Folder, X, Bot, Terminal as TerminalIcon } from 'lucide-react'

interface NewPanelModalProps {
  isOpen: boolean
  defaultCwd?: string
  lastUsedFolder?: string
  agentSettings?: AgentSettings
  onClose: () => void
  onCreate: (panel: Partial<PanelConfig>, folderToRemember?: string) => void
}

export const NewPanelModal: React.FC<NewPanelModalProps> = ({
  isOpen,
  defaultCwd,
  lastUsedFolder,
  agentSettings,
  onClose,
  onCreate
}) => {
  const initialFolder = lastUsedFolder || defaultCwd || process.env.HOME || '/'

  const [cwd, setCwd] = useState(initialFolder)
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [title, setTitle] = useState('Claude Code')
  const [extraArgs, setExtraArgs] = useState('')

  useEffect(() => {
    if (isOpen) {
      const folder = lastUsedFolder || defaultCwd || process.env.HOME || '/'
      setCwd(folder)
      setAgent('claude')
      setTitle('Claude Code')
      setExtraArgs(agentSettings?.claude?.args || '')
    }
  }, [isOpen, lastUsedFolder, defaultCwd, agentSettings])

  if (!isOpen) return null

  const handleAgentChange = (selected: AgentKind) => {
    setAgent(selected)
    if (selected === 'claude') {
      setTitle('Claude Code')
      setExtraArgs(agentSettings?.claude?.args || '')
    } else if (selected === 'codex') {
      setTitle('Codex')
      setExtraArgs(agentSettings?.codex?.args || '')
    } else {
      setTitle('Shell')
      setExtraArgs('')
    }
  }

  const handleBrowseDirectory = async () => {
    if (window.electronAPI) {
      const selected = await window.electronAPI.openDirectory(cwd)
      if (selected) {
        setCwd(selected)
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const chosenFolder = cwd.trim() || initialFolder
    const command =
      agent === 'claude'
        ? agentSettings?.claude?.command || 'claude'
        : agent === 'codex'
        ? agentSettings?.codex?.command || 'codex'
        : ''

    onCreate(
      {
        title: title.trim() || (agent === 'claude' ? 'Claude Code' : agent === 'codex' ? 'Codex' : 'Shell'),
        cwd: chosenFolder,
        agent,
        agentCommand: command || undefined,
        agentArgs: extraArgs.trim() || undefined
      },
      chosenFolder
    )

    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Panel</span>
          <button className="btn btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Agent / Type Choice */}
            <div className="form-group">
              <label className="form-label">Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  className={`preset-btn ${agent === 'claude' ? 'active' : ''}`}
                  style={{ padding: '10px 6px', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  onClick={() => handleAgentChange('claude')}
                >
                  <Bot size={18} />
                  <span>Claude Code</span>
                </button>

                <button
                  type="button"
                  className={`preset-btn ${agent === 'codex' ? 'active' : ''}`}
                  style={{ padding: '10px 6px', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  onClick={() => handleAgentChange('codex')}
                >
                  <Bot size={18} />
                  <span>Codex</span>
                </button>

                <button
                  type="button"
                  className={`preset-btn ${agent === 'none' ? 'active' : ''}`}
                  style={{ padding: '10px 6px', fontSize: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
                  onClick={() => handleAgentChange('none')}
                >
                  <TerminalIcon size={18} />
                  <span>Shell</span>
                </button>
              </div>
            </div>

            {/* Project Folder */}
            <div className="form-group">
              <label className="form-label">Project Folder</label>
              <div className="file-picker-row">
                <input
                  className="form-input"
                  placeholder="Select project folder..."
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn"
                  onClick={handleBrowseDirectory}
                  title="Browse local folder"
                >
                  <Folder size={14} />
                  Browse
                </button>
              </div>
            </div>

            {/* Extra Arguments (for Claude / Codex) */}
            {agent !== 'none' && (
              <div className="form-group">
                <label className="form-label">Extra Arguments (Optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. --verbose --model sonnet"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Split on spaces. Quotes are not interpreted, so values cannot contain spaces.
                </div>
              </div>
            )}

            {/* Custom Title (Optional) */}
            <div className="form-group">
              <label className="form-label">Panel Title</label>
              <input
                className="form-input"
                placeholder="e.g. Claude Code, Backend, Frontend"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Open Panel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
