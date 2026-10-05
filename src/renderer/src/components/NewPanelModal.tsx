import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanelConfig, AgentKind, AgentSettings } from '../../../shared/types'
import {
  AgentDetectionResult,
  AgentPresence,
  CUSTOM_AGENT,
  CUSTOM_AGENT_COLOR,
  MAX_PROMPT_LENGTH,
  NO_AGENT,
  getAgent,
  rankedAgents,
  resolveAgentArgs,
  supportsPrompt
} from '../../../shared/agents'
import { Folder, X, Terminal as TerminalIcon, RefreshCw, Copy, Check, ExternalLink, Wrench } from 'lucide-react'

interface NewPanelModalProps {
  isOpen: boolean
  defaultCwd?: string
  lastUsedFolder?: string
  agentSettings?: AgentSettings
  detection: AgentDetectionResult | null
  isDetecting: boolean
  onRefreshAgents: () => void
  onClose: () => void
  onCreate: (
    panel: Partial<PanelConfig>,
    folderToRemember?: string,
    options?: { prompt?: string }
  ) => void
}

const PRESENCE_NOTE: Partial<Record<AgentPresence, string>> = {
  shell: 'shell function',
  unknown: 'not checked'
}

/** The agent picked when the dialog opens: the first installed one. */
function defaultChoice(detection: AgentDetectionResult | null): string {
  const best = rankedAgents(detection)[0]
  return best && best.presence !== 'missing' ? best.id : NO_AGENT
}

export const NewPanelModal: React.FC<NewPanelModalProps> = ({
  isOpen,
  defaultCwd,
  lastUsedFolder,
  agentSettings,
  detection,
  isDetecting,
  onRefreshAgents,
  onClose,
  onCreate
}) => {
  const initialFolder = lastUsedFolder || defaultCwd || '/'

  const [cwd, setCwd] = useState(initialFolder)
  const [choice, setChoice] = useState<string>(NO_AGENT)
  const [title, setTitle] = useState('')
  const [extraArgs, setExtraArgs] = useState('')
  const [customCommand, setCustomCommand] = useState('')
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  // Until the user picks, a detection result that arrives late may move the
  // default to the first installed agent.
  const userChose = useRef(false)

  const ranked = useMemo(() => rankedAgents(detection), [detection])
  const available = ranked.filter((entry) => entry.presence !== 'missing')
  const missing = ranked.filter((entry) => entry.presence === 'missing')

  const choose = (next: string): void => {
    setChoice(next)
    setExtraArgs(getAgent(next) ? resolveAgentArgs(next, agentSettings) : '')
  }

  useEffect(() => {
    if (!isOpen) return
    userChose.current = false
    setCwd(lastUsedFolder || defaultCwd || '/')
    setTitle('')
    setCustomCommand('')
    setPrompt('')
    setCopied(null)
    choose(defaultChoice(detection))
    // Only when the dialog opens; detection updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const current = ranked.find((entry) => entry.id === choice)
    if (!userChose.current || current?.presence === 'missing') choose(defaultChoice(detection))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection])

  if (!isOpen) return null

  const pick = (next: string): void => {
    userChose.current = true
    choose(next)
  }

  const isAgent = choice !== NO_AGENT
  const agent = getAgent(choice)
  const takesPrompt = supportsPrompt(choice)
  const choiceName = agent?.name ?? (choice === CUSTOM_AGENT ? 'Custom command' : 'Shell')

  const handleBrowseDirectory = async (): Promise<void> => {
    const selected = await window.electronAPI?.openDirectory(cwd)
    if (selected) setCwd(selected)
  }

  const copyInstall = async (id: string, command: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(id)
      setTimeout(() => setCopied((curr) => (curr === id ? null : curr)), 1500)
    } catch {
      // The clipboard is unavailable; the command stays visible to copy by hand.
    }
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const chosenFolder = cwd.trim() || initialFolder
    if (choice === CUSTOM_AGENT && !customCommand.trim()) return

    onCreate(
      {
        title: title.trim() || undefined,
        cwd: chosenFolder,
        agent: choice as AgentKind,
        agentCommand: choice === CUSTOM_AGENT ? customCommand.trim() : undefined,
        agentArgs: isAgent ? extraArgs : undefined
      },
      chosenFolder,
      { prompt: takesPrompt && prompt.trim() ? prompt : undefined }
    )
    onClose()
  }

  const foundCount = ranked.filter((e) => e.presence === 'found' || e.presence === 'shell').length

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
        data-new-panel-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>New Panel</span>
          <button className="btn btn-sm btn-icon" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">Agent</label>
                <span className="detect-status" data-detect-status>
                  {isDetecting
                    ? 'Checking installed agents…'
                    : detection?.error
                      ? `Could not check (${detection.error}). Every agent is listed.`
                      : detection
                        ? `${foundCount} of ${ranked.length} installed`
                        : 'Not checked yet'}
                  <button
                    type="button"
                    className="btn btn-sm btn-icon"
                    title="Check installed agents again"
                    disabled={isDetecting}
                    onClick={onRefreshAgents}
                    data-detect-refresh
                  >
                    <RefreshCw size={11} className={isDetecting ? 'spin' : undefined} />
                  </button>
                </span>
              </div>
              <div className="agent-tiles">
                {available.map(({ id, presence }) => {
                  const def = getAgent(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`agent-tile ${choice === id ? 'active' : ''}`}
                      style={{ '--agent-color': def?.color } as React.CSSProperties}
                      aria-pressed={choice === id}
                      title={
                        presence === 'found'
                          ? detection?.agents.find((a) => a.id === id)?.path
                          : presence === 'shell'
                            ? 'Found as a shell function or alias. It runs if it starts the agent.'
                            : 'Not checked'
                      }
                      data-agent-choice={id}
                      data-presence={presence}
                      onClick={() => pick(id)}
                    >
                      <span className="agent-dot" />
                      <span className="agent-tile-name">{def?.name ?? id}</span>
                      {PRESENCE_NOTE[presence] && (
                        <span className="agent-tile-note">{PRESENCE_NOTE[presence]}</span>
                      )}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className={`agent-tile ${choice === NO_AGENT ? 'active' : ''}`}
                  style={{ '--agent-color': 'var(--text-secondary)' } as React.CSSProperties}
                  aria-pressed={choice === NO_AGENT}
                  data-agent-choice={NO_AGENT}
                  onClick={() => pick(NO_AGENT)}
                >
                  <TerminalIcon size={12} />
                  <span className="agent-tile-name">Shell</span>
                </button>
                <button
                  type="button"
                  className={`agent-tile ${choice === CUSTOM_AGENT ? 'active' : ''}`}
                  style={{ '--agent-color': CUSTOM_AGENT_COLOR } as React.CSSProperties}
                  aria-pressed={choice === CUSTOM_AGENT}
                  data-agent-choice={CUSTOM_AGENT}
                  onClick={() => pick(CUSTOM_AGENT)}
                >
                  <Wrench size={12} />
                  <span className="agent-tile-name">Custom</span>
                </button>
              </div>
            </div>

            {choice === CUSTOM_AGENT && (
              <div className="form-group">
                <label className="form-label">Command</label>
                <input
                  className="form-input"
                  placeholder="A command in PATH or a full path, e.g. /opt/tools/my-agent"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  data-custom-command
                  required
                />
              </div>
            )}

            {isAgent && (
              <div className="form-group">
                <label className="form-label">Extra Arguments (Optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. --verbose --model sonnet"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                  data-agent-args
                />
                <div className="form-hint">
                  Split on spaces. Quotes are not interpreted, so values cannot contain spaces.
                </div>
              </div>
            )}

            {isAgent &&
              (takesPrompt ? (
                <div className="form-group">
                  <label className="form-label">First Prompt (Optional)</label>
                  <textarea
                    className="form-input form-textarea"
                    rows={3}
                    maxLength={MAX_PROMPT_LENGTH}
                    placeholder={`What should ${choiceName} do? It starts working on this right away.`}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    data-first-prompt
                  />
                </div>
              ) : (
                <div className="form-hint">
                  {choiceName} cannot take a first prompt on its command line. Type it in the panel
                  once it starts.
                </div>
              ))}

            <div className="form-group">
              <label className="form-label">Project Folder</label>
              <div className="file-picker-row">
                <input
                  className="form-input"
                  placeholder="Select project folder..."
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  data-panel-cwd
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

            <div className="form-group">
              <label className="form-label">Panel Title</label>
              <input
                className="form-input"
                placeholder={choice === CUSTOM_AGENT ? 'The command name' : choiceName}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {missing.length > 0 && (
              <details className="missing-agents" data-missing-agents>
                <summary>Not installed ({missing.length})</summary>
                <div className="form-hint">
                  Not found in your login shell&apos;s PATH. Install one, then check again. Installed
                  somewhere else? Use Custom with its full path.
                </div>
                <ul>
                  {missing.map(({ id }) => {
                    const def = getAgent(id)
                    if (!def) return null
                    return (
                      <li key={id} data-missing-agent={id}>
                        <span
                          className="agent-dot"
                          style={{ '--agent-color': def.color } as React.CSSProperties}
                        />
                        <span className="missing-name">{def.name}</span>
                        <code title={def.install}>{def.install}</code>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon"
                          title="Copy the install command"
                          onClick={() => void copyInstall(id, def.install)}
                        >
                          {copied === id ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon"
                          title={def.homepage}
                          onClick={() => window.electronAPI?.openExternal(def.homepage)}
                        >
                          <ExternalLink size={11} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" data-new-panel-submit>
              {isAgent ? `Start ${choiceName}` : 'Open Shell'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
