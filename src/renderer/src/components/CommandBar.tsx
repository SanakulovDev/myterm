import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PanelStatus, WorkspaceConfig } from '../../../shared/types'
import {
  AgentDetectionResult,
  MAX_PROMPT_LENGTH,
  agentLabel,
  getAgent
} from '../../../shared/agents'
import { terminalRegistry } from '../terminal/terminals'
import {
  AUTO_TARGET,
  CommandTarget,
  defaultPromptAgent,
  isAutoChoice,
  isPanelBusy,
  newAgentTargetValue,
  panelTargetValue,
  promptableAgents,
  resolveCommandTarget
} from './command-target'
import { CornerDownLeft } from 'lucide-react'

interface CommandBarProps {
  workspace: WorkspaceConfig
  activePanelId: string | null
  panelStatuses: Record<string, { status: PanelStatus } | undefined>
  detection: AgentDetectionResult | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onSendPrompt: (panelId: string, text: string) => boolean
  onStartAgent: (agent: string, text: string) => Promise<string | undefined>
}

// The agent the bar last started, remembered per viewer.
const AGENT_KEY = 'myterm.commandBar.agent'
const MAX_ROWS = 8

function readRememberedAgent(): string | null {
  try {
    return window.localStorage.getItem(AGENT_KEY)
  } catch {
    return null
  }
}

function rememberAgent(agent: string): void {
  try {
    window.localStorage.setItem(AGENT_KEY, agent)
  } catch {
    // Storage unavailable; the default agent is used next time.
  }
}

/**
 * A prompt box under the grid. A prompt goes to the active panel while a
 * program runs there; otherwise it starts an agent with the prompt.
 */
export const CommandBar: React.FC<CommandBarProps> = ({
  workspace,
  activePanelId,
  panelStatuses,
  detection,
  inputRef,
  onSendPrompt,
  onStartAgent
}) => {
  const [text, setText] = useState('')
  const [choice, setChoice] = useState(AUTO_TARGET)
  const [remembered, setRemembered] = useState<string | null>(() => readRememberedAgent())
  const [error, setError] = useState<string | null>(null)
  // Main's last answer for the active panel: a command runs in its shell.
  const [runsCommand, setRunsCommand] = useState<{ panelId: string | null; busy: boolean }>({
    panelId: null,
    busy: false
  })
  const activeRef = useRef(activePanelId)
  activeRef.current = activePanelId
  // One prompt at a time: a second Enter while the first is on its way would
  // start a second agent.
  const sendingRef = useRef(false)

  // An agent typed into a shell by hand has no status; ask main whether a
  // command runs there. False when it cannot tell.
  const checkActive = useCallback(async (): Promise<boolean> => {
    const id = activeRef.current
    if (!id || !window.electronAPI?.isPtyBusy) return false
    let busy = false
    try {
      busy = await window.electronAPI.isPtyBusy(id)
    } catch {
      // Treated as idle.
    }
    if (activeRef.current === id) setRunsCommand({ panelId: id, busy })
    return busy
  }, [])

  // A new active panel means a new default destination.
  useEffect(() => {
    setChoice(AUTO_TARGET)
    setError(null)
    setRunsCommand({ panelId: activePanelId, busy: false })
    void checkActive()
  }, [activePanelId, workspace.id, checkActive])

  const agents = useMemo(() => promptableAgents(detection), [detection])
  const newAgent = defaultPromptAgent(remembered, detection)
  const target = resolveCommandTarget({
    choice,
    panels: workspace.panels,
    activePanelId,
    statuses: panelStatuses,
    newAgent,
    activeRunsCommand: runsCommand.panelId === activePanelId && runsCommand.busy
  })
  const panelTitle = (id: string): string | undefined => workspace.panels.find((p) => p.id === id)?.title
  const hint =
    target.kind === 'panel'
      ? `to ${panelTitle(target.panelId) ?? 'panel'}`
      : `starts ${getAgent(target.agent)?.name ?? target.agent}`

  // Grow with the text, up to MAX_ROWS lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 18
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + 12)}px`
  }, [text, inputRef])

  const submit = async (): Promise<void> => {
    if (!text.trim() || sendingRef.current) return
    sendingRef.current = true
    try {
      await deliver()
    } finally {
      sendingRef.current = false
    }
  }

  const deliver = async (): Promise<void> => {
    setError(null)
    let dest: CommandTarget = target
    // Automatic, with no status saying a program runs in the active panel:
    // ask main again right now. A prompt typed into an idle shell would run
    // as a command, and an agent typed by hand since the last check should
    // get the prompt rather than a second agent.
    if (
      isAutoChoice(choice, workspace.panels) &&
      activePanelId &&
      !isPanelBusy(panelStatuses[activePanelId]?.status)
    ) {
      dest = (await checkActive()) ? { kind: 'panel', panelId: activePanelId } : { kind: 'new', agent: newAgent }
    }
    if (dest.kind === 'panel') {
      if (onSendPrompt(dest.panelId, text)) setText('')
      else setError(`${panelTitle(dest.panelId) ?? 'The panel'} is not running yet.`)
      return
    }
    rememberAgent(dest.agent)
    setRemembered(dest.agent)
    const id = await onStartAgent(dest.agent, text)
    if (id) setText('')
    else setError('Could not open a panel.')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      void submit()
    } else if (e.key === 'Escape' && activePanelId) {
      e.preventDefault()
      terminalRegistry.focus(activePanelId)
    }
  }

  const onChoose = (value: string): void => {
    setChoice(value)
    setError(null)
    if (value.startsWith('new:')) {
      const agent = value.slice('new:'.length)
      rememberAgent(agent)
      setRemembered(agent)
    }
  }

  return (
    <div className="command-bar" data-command-bar>
      <select
        className="command-target"
        value={choice}
        onChange={(e) => onChoose(e.target.value)}
        title="Where the prompt goes"
        data-command-target
      >
        <option value={AUTO_TARGET}>Auto</option>
        <optgroup label="Send to panel">
          {workspace.panels.map((panel) => (
            <option key={panel.id} value={panelTargetValue(panel.id)}>
              {panel.title} ({agentLabel(panel)})
            </option>
          ))}
        </optgroup>
        <optgroup label="Start a new agent">
          {agents.map((agent) => (
            <option key={agent} value={newAgentTargetValue(agent)}>
              New {getAgent(agent)?.name ?? agent}
            </option>
          ))}
        </optgroup>
      </select>
      <div className="command-input-wrap">
        <textarea
          ref={inputRef}
          className="command-input"
          rows={1}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder="Prompt an agent… (Enter to send, Shift+Enter for a new line, Cmd+L to focus)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => void checkActive()}
          spellCheck={false}
          data-command-input
        />
        <span className={`command-hint ${error ? 'error' : ''}`} data-command-hint>
          {error ?? hint}
        </span>
      </div>
      <button
        className="btn btn-sm btn-primary"
        disabled={!text.trim()}
        onClick={() => void submit()}
        title="Send (Enter)"
        data-command-send
      >
        <CornerDownLeft size={12} />
      </button>
    </div>
  )
}
