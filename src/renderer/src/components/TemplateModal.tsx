import React, { useState, useEffect } from 'react'
import { WorkspaceConfig, PanelConfig } from '../../../shared/types'
import { X, Save, Trash2, ArrowRight } from 'lucide-react'

interface SavedTemplate {
  id: string
  name: string
  layout: { rows: number; cols: number }
  panels: Omit<PanelConfig, 'id'>[]
}

interface TemplateModalProps {
  isOpen: boolean
  activeWorkspace: WorkspaceConfig | null
  onClose: () => void
  onApplyTemplate: (name: string, panels: PanelConfig[]) => void
}

const TEMPLATES_STORAGE_KEY = 'agent_terminal_templates'

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  activeWorkspace,
  onClose,
  onApplyTemplate
}) => {
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  const [templateName, setTemplateName] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY)
      if (raw) {
        setTemplates(JSON.parse(raw))
      } else {
        // Pre-populate with standard sample templates if empty
        const defaultTemplates: SavedTemplate[] = [
          {
            id: 'tpl-1',
            name: 'Full Stack (Frontend + Backend + Agent)',
            layout: { rows: 2, cols: 2 },
            panels: [
              {
                title: 'Claude Agent',
                cwd: process.env.HOME || '/',
                agent: 'claude',
                agentCommand: 'claude',
                shell: '/bin/zsh'
              },
              {
                title: 'Backend API',
                cwd: process.env.HOME || '/',
                agent: 'none',
                shell: '/bin/zsh'
              },
              {
                title: 'Frontend Dev',
                cwd: process.env.HOME || '/',
                agent: 'none',
                shell: '/bin/zsh'
              },
              {
                title: 'Codex / Tests',
                cwd: process.env.HOME || '/',
                agent: 'codex',
                agentCommand: 'codex',
                shell: '/bin/zsh'
              }
            ]
          }
        ]
        setTemplates(defaultTemplates)
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(defaultTemplates))
      }
    } catch {
      // ignore
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSaveCurrent = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace || !templateName.trim()) return

    const newTemplate: SavedTemplate = {
      id: `tpl-${Date.now()}`,
      name: templateName.trim(),
      layout: activeWorkspace.layout,
      panels: activeWorkspace.panels.map(({ id: _id, ...rest }) => rest)
    }

    const updated = [...templates, newTemplate]
    setTemplates(updated)
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated))
    setTemplateName('')
  }

  const handleDelete = (id: string) => {
    const updated = templates.filter((t) => t.id !== id)
    setTemplates(updated)
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated))
  }

  const handleApply = (tpl: SavedTemplate) => {
    const panelsWithIds: PanelConfig[] = tpl.panels.map((p, idx) => ({
      ...p,
      id: `panel-${Date.now()}-${idx}`
    }))
    onApplyTemplate(tpl.name, panelsWithIds)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-header">
          <span>Workspace Templates</span>
          <button className="btn btn-sm btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {/* Save current as template */}
          <form onSubmit={handleSaveCurrent}>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>
              Save current setup ({activeWorkspace?.panels.length || 0} panels)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Template name (e.g. Backend + Frontend)"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!templateName.trim() || !activeWorkspace}
              >
                <Save size={13} />
                Save
              </button>
            </div>
          </form>

          <hr style={{ borderColor: 'var(--border-color)', margin: '8px 0' }} />

          {/* List of saved templates */}
          <label className="form-label">Available Templates ({templates.length})</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tpl.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {tpl.panels.length} panel(s) · Grid {tpl.layout.rows}×{tpl.layout.cols}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-sm btn-icon"
                    title="Delete template"
                    onClick={() => handleDelete(tpl.id)}
                  >
                    <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleApply(tpl)}
                    title="Create workspace with this template"
                  >
                    Load
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
