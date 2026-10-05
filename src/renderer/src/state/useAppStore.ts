import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { AgentKind, AppState, WorkspaceConfig, PanelConfig, PanelStatus, LayoutMode } from '../../../shared/types'
import {
  AgentDetectionResult,
  NO_AGENT,
  agentLabel,
  getAgent,
  isAgentPanel,
  layoutForCount,
  resolveAgentArgs,
  resolveAgentCommand
} from '../../../shared/agents'
import { DEFAULT_UI_STATE } from '../../../shared/layout'
import { generatePanelName } from '../../../shared/autoname'
import { terminalRegistry } from '../terminal/terminals'

/** One panel of a lineup launched together (a preset). */
export interface LineupPanel {
  agent: string
  title: string
  /** The agent's first prompt; ignored by agents that cannot take one. */
  prompt?: string
}

let panelSequence = 0

// Unique even for several panels created in the same millisecond.
function newPanelId(): string {
  panelSequence += 1
  return `panel-${Date.now()}-${panelSequence}`
}

/**
 * A new panel from what the caller chose; the rest comes from the agent
 * settings (command, arguments) and the registry (title).
 */
function buildPanel(
  id: string,
  config: Partial<PanelConfig>,
  state: AppState,
  defaultShell: string
): PanelConfig {
  const agent = config.agent || NO_AGENT
  const isAgent = isAgentPanel({ agent })
  const known = !!getAgent(agent)
  const agentCommand = isAgent
    ? config.agentCommand?.trim() ||
      (known ? resolveAgentCommand(agent, state.agentSettings) : undefined)
    : undefined
  // Arguments the caller gave win, even none (a cleared field); otherwise the
  // agent's saved or default arguments.
  const givenArgs = config.agentArgs
  const agentArgs = isAgent
    ? (givenArgs !== undefined
        ? givenArgs.trim()
        : known
          ? resolveAgentArgs(agent, state.agentSettings)
          : '') || undefined
    : undefined
  const hasManualTitle = Boolean(config.title?.trim())
  const autoName =
    config.autoName !== undefined
      ? config.autoName
      : hasManualTitle
        ? false
        : isAgent
  return {
    id,
    title: config.title?.trim() || agentLabel({ agent, agentCommand }),
    cwd: config.cwd || state.lastUsedFolder || '/',
    agent,
    agentCommand,
    agentArgs,
    shell: config.shell || defaultShell,
    autoName
  }
}

// Templates saved before schema v2 may still carry runtime fields.
function stripRuntimeFields(panel: PanelConfig): PanelConfig {
  const { status: _status, unread: _unread, autoLaunch: _autoLaunch, ...rest } =
    panel as PanelConfig & Record<string, unknown>
  return rest as PanelConfig
}

export function useAppStore() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [maximizedPanelId, setMaximizedPanelId] = useState<string | null>(null)
  const [panelStatuses, setPanelStatuses] = useState<
    Record<string, { status: PanelStatus; detail?: string; unread?: boolean }>
  >({})
  const [isNewPanelModalOpen, setIsNewPanelModalOpen] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false)
  const [searchPanelId, setSearchPanelId] = useState<string | null>(null)
  const [agentDetection, setAgentDetection] = useState<AgentDetectionResult | null>(null)
  const [isDetectingAgents, setIsDetectingAgents] = useState(false)
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set())

  // Check which workspaces have missing rootPath
  useEffect(() => {
    if (!appState || !window.electronAPI?.pathsExist) return
    const pathsToCheck = appState.workspaces
      .map((w) => w.rootPath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    if (pathsToCheck.length === 0) {
      setMissingPaths(new Set())
      return
    }

    window.electronAPI
      .pathsExist(pathsToCheck)
      .then((existsList) => {
        const missing = new Set<string>()
        pathsToCheck.forEach((p, idx) => {
          if (!existsList[idx]) missing.add(p)
        })
        setMissingPaths(missing)
      })
      .catch(() => {})
  }, [appState?.workspaces])

  // Load initial state from disk
  useEffect(() => {
    async function init() {
      if (window.electronAPI) {
        const state = await window.electronAPI.loadState()
        setAppState(state)
        const activeWs = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
        if (activeWs && activeWs.panels.length > 0) {
          setActivePanelId(activeWs.panels[0].id)
          window.electronAPI.notifyPanelFocus(activeWs.panels[0].id)
        }
      }
    }
    init()
  }, [])

  // Which agent CLIs are installed. Main keeps the result; `refresh` checks again.
  const refreshAgents = useCallback(async (refresh = false) => {
    if (!window.electronAPI?.detectAgents) return
    setIsDetectingAgents(true)
    try {
      setAgentDetection(await window.electronAPI.detectAgents(refresh))
    } catch {
      // The last result stays; agents without one count as launchable.
    } finally {
      setIsDetectingAgents(false)
    }
  }, [])

  useEffect(() => {
    void refreshAgents(false)
  }, [refreshAgents])

  // Auto-save state when appState changes
  useEffect(() => {
    if (appState && window.electronAPI) {
      window.electronAPI.saveState(appState)
    }
  }, [appState])

  // Subscribe to agent status and notification focus events
  useEffect(() => {
    if (!window.electronAPI) return

    const unsubStatus = window.electronAPI.onAgentStatus((id, status, detail) => {
      setPanelStatuses((prev) => {
        const isCurrentActive = id === activePanelId
        const isUnread = !isCurrentActive && (status === 'waiting' || status === 'done')
        return {
          ...prev,
          [id]: {
            status,
            detail,
            unread: isUnread ? true : prev[id]?.unread
          }
        }
      })
    })

    const unsubFocus = window.electronAPI.onFocusPanel((panelId) => {
      handleSelectPanel(panelId)
    })

    return () => {
      unsubStatus()
      unsubFocus()
    }
  }, [activePanelId])

  const activeWorkspace = useMemo(() => {
    if (!appState) return null
    return (
      appState.workspaces.find((w) => w.id === appState.activeWorkspaceId) ||
      appState.workspaces[0] ||
      null
    )
  }, [appState])

  const handleSelectPanel = useCallback((id: string) => {
    setActivePanelId(id)
    if (window.electronAPI) {
      window.electronAPI.notifyPanelFocus(id)
    }
    setPanelStatuses((prev) => {
      if (!prev[id]?.unread) return prev
      return {
        ...prev,
        [id]: { ...prev[id], unread: false }
      }
    })
  }, [])

  const handleToggleMaximize = useCallback(
    (id?: string) => {
      const targetId = id || activePanelId
      if (!targetId) return
      setMaximizedPanelId((current) => (current === targetId ? null : targetId))
    },
    [activePanelId]
  )

  const handleSetLayout = useCallback((rows: number, cols: number) => {
    setAppState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        workspaces: prev.workspaces.map((ws) =>
          ws.id === prev.activeWorkspaceId
            ? { ...ws, layout: { ...ws.layout, mode: 'grid' as const, rows, cols } }
            : ws
        )
      }
    })
  }, [])

  const handleSetLayoutMode = useCallback((mode: LayoutMode) => {
    setAppState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        workspaces: prev.workspaces.map((ws) =>
          ws.id === prev.activeWorkspaceId
            ? { ...ws, layout: { ...ws.layout, mode } }
            : ws
        )
      }
    })
  }, [])

  const handleToggleSidebar = useCallback(() => {
    setAppState((prev) => {
      if (!prev) return prev
      const currentUi = prev.ui || DEFAULT_UI_STATE
      return {
        ...prev,
        ui: {
          ...currentUi,
          sidebarVisible: !currentUi.sidebarVisible
        }
      }
    })
  }, [])

  const handleToggleWorkspaceCollapse = useCallback((wsId: string) => {
    setAppState((prev) => {
      if (!prev) return prev
      const currentUi = prev.ui || DEFAULT_UI_STATE
      const collapsed = currentUi.collapsedWorkspaceIds || []
      const isCollapsed = collapsed.includes(wsId)
      const nextCollapsed = isCollapsed
        ? collapsed.filter((id) => id !== wsId)
        : [...collapsed, wsId]
      return {
        ...prev,
        ui: {
          ...currentUi,
          collapsedWorkspaceIds: nextCollapsed
        }
      }
    })
  }, [])

  const handleAddPanel = useCallback(
    async (
      config: Partial<PanelConfig>,
      folderToRemember?: string,
      options: { prompt?: string } = {}
    ): Promise<string | undefined> => {
      if (!appState || !activeWorkspace) return undefined

      const defaultShell = await window.electronAPI.getDefaultShell()
      const newId = newPanelId()
      const newPanel = buildPanel(newId, config, appState, defaultShell)

      // Only a panel created here auto-launches its agent (on its first spawn).
      if (isAgentPanel(newPanel)) {
        terminalRegistry.markLaunchPending(newId, options.prompt)
      }

      setAppState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          lastUsedFolder: folderToRemember || config.cwd || prev.lastUsedFolder,
          workspaces: prev.workspaces.map((ws) => {
            if (ws.id !== prev.activeWorkspaceId) return ws
            return {
              ...ws,
              panels: [...ws.panels, newPanel],
              panelOrder: [...ws.panelOrder, newId]
            }
          })
        }
      })

      handleSelectPanel(newId)
      return newId
    },
    [appState, activeWorkspace, handleSelectPanel]
  )

  const handleRemovePanel = useCallback(
    (id: string) => {
      if (window.electronAPI) {
        window.electronAPI.killPty(id)
      }
      terminalRegistry.destroy(id)

      if (maximizedPanelId === id) {
        setMaximizedPanelId(null)
      }

      setAppState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          workspaces: prev.workspaces.map((ws) => {
            if (ws.id !== prev.activeWorkspaceId) return ws
            const newPanels = ws.panels.filter((p) => p.id !== id)
            return {
              ...ws,
              panels: newPanels,
              panelOrder: ws.panelOrder.filter((pId) => pId !== id)
            }
          })
        }
      })

      // Select another remaining panel
      if (activeWorkspace) {
        const remaining = activeWorkspace.panels.filter((p) => p.id !== id)
        if (remaining.length > 0) {
          handleSelectPanel(remaining[0].id)
        } else {
          setActivePanelId(null)
        }
      }
    },
    [maximizedPanelId, activeWorkspace, handleSelectPanel]
  )

  const handleUpdatePanel = useCallback((id: string, updates: Partial<PanelConfig>) => {
    setAppState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        workspaces: prev.workspaces.map((ws) => {
          if (ws.id !== prev.activeWorkspaceId) return ws
          return {
            ...ws,
            panels: ws.panels.map((p) => (p.id === id ? { ...p, ...updates } : p))
          }
        })
      }
    })
  }, [])

  const handleSwitchWorkspace = useCallback(
    (wsId: string) => {
      setMaximizedPanelId(null)
      setAppState((prev) => {
        if (!prev) return prev
        return { ...prev, activeWorkspaceId: wsId }
      })
      const targetWs = appState?.workspaces.find((w) => w.id === wsId)
      if (targetWs && targetWs.panels.length > 0) {
        handleSelectPanel(targetWs.panels[0].id)
      } else {
        setActivePanelId(null)
      }
    },
    [appState, handleSelectPanel]
  )

  const handleCreateWorkspace = useCallback(
    async (name: string, templatePanels?: PanelConfig[]) => {
      if (!appState) return
      const defaultShell = await window.electronAPI.getDefaultShell()
      const newWsId = `ws-${Date.now()}`
      const initialPanels: PanelConfig[] = templatePanels
        ? templatePanels.map((p, idx) => ({
            ...stripRuntimeFields(p),
            id: `${newPanelId()}-${idx}`,
            shell: p.shell || defaultShell
          }))
        : [
            {
              id: newPanelId(),
              title: 'Terminal 1',
              cwd: appState.lastUsedFolder || '/',
              agent: 'none',
              shell: defaultShell
            }
          ]

      const newWorkspace: WorkspaceConfig = {
        id: newWsId,
        name: name || `Workspace ${appState.workspaces.length + 1}`,
        rootPath: appState.lastUsedFolder,
        layout: { mode: 'stack', rows: 1, cols: Math.min(initialPanels.length, 3) || 1 },
        panels: initialPanels,
        panelOrder: initialPanels.map((p) => p.id)
      }

      setAppState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          workspaces: [...prev.workspaces, newWorkspace],
          activeWorkspaceId: newWsId
        }
      })

      handleSelectPanel(initialPanels[0].id)
    },
    [appState, handleSelectPanel]
  )

  // A preset: a new workspace whose panels start their agents (with their
  // first prompts) as soon as they are shown.
  const handleLaunchLineup = useCallback(
    async (name: string, cwd: string, lineup: LineupPanel[]) => {
      if (!appState || lineup.length === 0) return
      const defaultShell = await window.electronAPI.getDefaultShell()
      const panels = lineup.map((slot) =>
        buildPanel(
          newPanelId(),
          { agent: slot.agent as AgentKind, title: slot.title, cwd },
          appState,
          defaultShell
        )
      )
      panels.forEach((panel, i) => {
        if (isAgentPanel(panel)) terminalRegistry.markLaunchPending(panel.id, lineup[i].prompt)
      })

      const newWorkspace: WorkspaceConfig = {
        id: `ws-${Date.now()}`,
        name: name.trim() || `Workspace ${appState.workspaces.length + 1}`,
        rootPath: cwd || appState.lastUsedFolder,
        layout: { mode: 'stack', ...layoutForCount(panels.length) },
        panels,
        panelOrder: panels.map((p) => p.id)
      }

      setMaximizedPanelId(null)
      setAppState((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          lastUsedFolder: cwd || prev.lastUsedFolder,
          workspaces: [...prev.workspaces, newWorkspace],
          activeWorkspaceId: newWorkspace.id
        }
      })
      handleSelectPanel(panels[0].id)
    },
    [appState, handleSelectPanel]
  )

  /** Types `text` into a panel's running program and submits it. */
  const handleSendPrompt = useCallback(
    (panelId: string, text: string): boolean => {
      const sent = terminalRegistry.sendPrompt(panelId, text, true)
      if (sent) handleSelectPanel(panelId)
      return sent
    },
    [handleSelectPanel]
  )

  /**
   * A new panel in the current workspace running `agent` with `text` as its
   * first prompt, in the folder of the active panel.
   */
  const handleStartAgentWithPrompt = useCallback(
    (agent: string, text: string): Promise<string | undefined> => {
      const active = activeWorkspace?.panels.find((p) => p.id === activePanelId)
      return handleAddPanel(
        { agent: agent as AgentKind, cwd: active?.cwd || appState?.lastUsedFolder },
        undefined,
        { prompt: text }
      )
    },
    [activeWorkspace, activePanelId, appState, handleAddPanel]
  )

  // Launch and Restart both respawn the panel's PTY through the launch script
  // (main kills the current shell/agent first). Status comes back from main.
  const handleRequestLaunch = useCallback(
    (panelId: string) => {
      const panel = appState?.workspaces.flatMap((ws) => ws.panels).find((p) => p.id === panelId)
      if (panel) terminalRegistry.launch(panel)
    },
    [appState]
  )

  const handleFocusNextUnread = useCallback(() => {
    if (!activeWorkspace) return
    const unreadPanel = activeWorkspace.panels.find((p) => panelStatuses[p.id]?.unread)
    if (unreadPanel) {
      handleSelectPanel(unreadPanel.id)
    }
  }, [activeWorkspace, panelStatuses, handleSelectPanel])

  return {
    appState,
    activeWorkspace,
    activePanelId,
    maximizedPanelId,
    panelStatuses,
    agentSettings: appState?.agentSettings,
    lastUsedFolder: appState?.lastUsedFolder,
    isNewPanelModalOpen,
    isTemplateModalOpen,
    isLaunchModalOpen,
    searchPanelId,
    agentDetection,
    isDetectingAgents,
    missingPaths,
    isSidebarVisible: appState?.ui?.sidebarVisible ?? true,
    sidebarWidth: appState?.ui?.sidebarWidth ?? 264,
    collapsedWorkspaceIds: appState?.ui?.collapsedWorkspaceIds ?? [],
    refreshAgents,
    setSearchPanelId,
    setIsNewPanelModalOpen,
    setIsTemplateModalOpen,
    setIsLaunchModalOpen,
    selectPanel: handleSelectPanel,
    toggleMaximize: handleToggleMaximize,
    setLayout: handleSetLayout,
    setLayoutMode: handleSetLayoutMode,
    setLayoutGridPreset: handleSetLayout,
    toggleSidebar: handleToggleSidebar,
    toggleWorkspaceCollapse: handleToggleWorkspaceCollapse,
    addPanel: handleAddPanel,
    removePanel: handleRemovePanel,
    updatePanel: handleUpdatePanel,
    switchWorkspace: handleSwitchWorkspace,
    createWorkspace: handleCreateWorkspace,
    launchLineup: handleLaunchLineup,
    sendPrompt: handleSendPrompt,
    startAgentWithPrompt: handleStartAgentWithPrompt,
    launchAgent: handleRequestLaunch,
    restartAgent: handleRequestLaunch,
    focusNextUnread: handleFocusNextUnread
  }
}
