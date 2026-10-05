import React, { useEffect, useMemo, useState } from 'react'
import {
  AgentDetectionResult,
  LineupSlot,
  MAX_PROMPT_LENGTH,
  NO_AGENT,
  PRESETS,
  PresetId,
  SWARM_ROLES,
  agentColor,
  getAgent,
  installedAgents,
  layoutForCount,
  presetLineup,
  rankedAgents,
  supportsPrompt,
  swarmPrompt
} from '../../../shared/agents'
import { LineupPanel } from '../state/useAppStore'
import { Folder, Plus, Rocket, Trash2, X } from 'lucide-react'

interface AgentLaunchModalProps {
  isOpen: boolean
  defaultCwd?: string
  detection: AgentDetectionResult | null
  onClose: () => void
  onLaunch: (name: string, cwd: string, lineup: LineupPanel[]) => void
}

// Room left in a first prompt for a swarm role's brief.
const MAX_TASK_LENGTH = MAX_PROMPT_LENGTH - 1024

function slotName(agent: string): string {
  return agent === NO_AGENT ? 'Shell' : (getAgent(agent)?.name ?? agent)
}

/** The swarm role of the slot at `index`; roles repeat with a number. */
function swarmRole(index: number): { title: string; brief: string } {
  const role = SWARM_ROLES[index % SWARM_ROLES.length]
  const round = Math.floor(index / SWARM_ROLES.length)
  return round === 0 ? role : { ...role, title: `${role.title} ${round + 1}` }
}

export const AgentLaunchModal: React.FC<AgentLaunchModalProps> = ({
  isOpen,
  defaultCwd,
  detection,
  onClose,
  onLaunch
}) => {
  const installed = useMemo(() => installedAgents(detection), [detection])
  // Every agent not known to be missing can be picked by hand.
  const pickable = useMemo(
    () => rankedAgents(detection).filter((e) => e.presence !== 'missing').map((e) => e.id),
    [detection]
  )

  const [preset, setPreset] = useState<PresetId>('pair')
  const [slots, setSlots] = useState<LineupSlot[]>([])
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(defaultCwd || '/')
  const [task, setTask] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setPreset('pair')
    setSlots(presetLineup('pair', installed))
    setName('')
    setCwd(defaultCwd || '/')
    setTask('')
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  const presetDef = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]
  const isSwarm = preset === 'swarm'

  const choosePreset = (next: PresetId): void => {
    setPreset(next)
    setSlots(presetLineup(next, installed))
  }

  const updateSlot = (index: number, update: Partial<LineupSlot>): void => {
    setSlots((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...update } : slot)))
  }

  const changeAgent = (index: number, agent: string): void => {
    const slot = slots[index]
    // A title still naming the old agent follows the new one; roles stay.
    const followsAgent = !slot.brief && (slot.title.trim() === '' || slot.title === slotName(slot.agent))
    updateSlot(index, followsAgent ? { agent, title: slotName(agent) } : { agent })
  }

  const addSlot = (): void => {
    setSlots((prev) => {
      if (prev.length >= presetDef.maxSlots) return prev
      const pool = installed.length > 0 ? installed : pickable
      const agent = pool[prev.length % Math.max(pool.length, 1)] ?? 'claude'
      if (isSwarm) {
        const role = swarmRole(prev.length)
        return [...prev, { agent, title: role.title, brief: role.brief }]
      }
      return [...prev, { agent, title: slotName(agent) }]
    })
  }

  const removeSlot = (index: number): void => {
    setSlots((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  const handleBrowseDirectory = async (): Promise<void> => {
    const selected = await window.electronAPI?.openDirectory(cwd)
    if (selected) setCwd(selected)
  }

  const promptFor = (slot: LineupSlot): string | undefined => {
    if (slot.agent === NO_AGENT || !supportsPrompt(slot.agent)) return undefined
    if (isSwarm) return swarmPrompt(slot.brief, task)
    return task.trim() ? task : undefined
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (slots.length === 0) return
    const lineup: LineupPanel[] = slots.map((slot) => ({
      agent: slot.agent,
      title: slot.title.trim() || slotName(slot.agent),
      prompt: promptFor(slot)
    }))
    onLaunch(name.trim() || presetDef.name, cwd.trim() || defaultCwd || '/', lineup)
    onClose()
  }

  // Agents in the lineup that start without the task.
  const noPrompt = task.trim()
    ? [
        ...new Set(
          slots
            .filter((slot) => slot.agent !== NO_AGENT && !supportsPrompt(slot.agent))
            .map((slot) => slotName(slot.agent))
        )
      ]
    : []
  const grid = layoutForCount(slots.length)
  const optionsFor = (current: string): string[] =>
    pickable.includes(current) || current === NO_AGENT ? pickable : [current, ...pickable]

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="modal-dialog modal-wide"
        data-launch-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Launch Agents</span>
          <button className="btn btn-sm btn-icon" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="preset-tabs" role="tablist">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={preset === p.id}
                  className={`preset-tab ${preset === p.id ? 'active' : ''}`}
                  data-preset={p.id}
                  onClick={() => choosePreset(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="form-hint">{presetDef.description} Opens in a new workspace.</div>

            <div className="launch-layout">
              <div className="lineup">
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className="lineup-row"
                    data-slot-index={index}
                    style={{ '--agent-color': slot.agent === NO_AGENT ? 'var(--text-secondary)' : agentColor(slot.agent) } as React.CSSProperties}
                  >
                    <span className="agent-dot" />
                    <select
                      className="form-select"
                      value={slot.agent}
                      onChange={(e) => changeAgent(index, e.target.value)}
                      data-slot-agent
                      aria-label={`Panel ${index + 1} agent`}
                    >
                      {optionsFor(slot.agent).map((id) => (
                        <option key={id} value={id}>
                          {slotName(id)}
                          {installed.includes(id) ? '' : ' (not checked)'}
                        </option>
                      ))}
                      <option value={NO_AGENT}>Shell</option>
                    </select>
                    <input
                      className="form-input"
                      value={slot.title}
                      placeholder={slotName(slot.agent)}
                      onChange={(e) => updateSlot(index, { title: e.target.value })}
                      title={slot.brief}
                      aria-label={`Panel ${index + 1} title`}
                      data-slot-title
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-icon"
                      title="Remove"
                      disabled={slots.length <= 1}
                      onClick={() => removeSlot(index)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {slots.length < presetDef.maxSlots && (
                  <button type="button" className="btn btn-sm" onClick={addSlot} data-slot-add>
                    <Plus size={12} />
                    Add panel
                  </button>
                )}
              </div>

              <div
                className="lineup-preview"
                style={{
                  gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${grid.rows}, 1fr)`
                }}
                aria-hidden
              >
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className="lineup-cell"
                    style={{ '--agent-color': slot.agent === NO_AGENT ? 'var(--text-secondary)' : agentColor(slot.agent) } as React.CSSProperties}
                  >
                    {slot.title.trim() || slotName(slot.agent)}
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Task (Optional)</label>
              <textarea
                className="form-input form-textarea"
                rows={3}
                maxLength={MAX_TASK_LENGTH}
                placeholder={
                  isSwarm
                    ? 'What should the team work on? Each agent gets its role and this task.'
                    : 'Sent as the first prompt to every agent that takes one.'
                }
                value={task}
                onChange={(e) => setTask(e.target.value)}
                data-launch-task
              />
              {noPrompt.length > 0 && (
                <div className="form-hint">
                  Starts without the task (no first prompt on the command line): {noPrompt.join(', ')}.
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Workspace Name</label>
                <input
                  className="form-input"
                  placeholder={presetDef.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-launch-name
                />
              </div>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Project Folder</label>
                <div className="file-picker-row">
                  <input
                    className="form-input"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    data-launch-cwd
                    required
                  />
                  <button type="button" className="btn" onClick={handleBrowseDirectory} title="Browse local folder">
                    <Folder size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" data-launch-submit>
              <Rocket size={12} />
              Launch {slots.length} {slots.length === 1 ? 'panel' : 'panels'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
