import { useState, useEffect, useCallback, useMemo } from 'react'
import { AppState, WorkspaceConfig, PanelConfig, PanelStatus, AgentKind } from '../../../shared/types'
import { terminalRegistry } from '../terminal/terminals'

const AGENT_DEFAULT_COMMANDS: Record<AgentKind, string> = {
  none: '',
  claude: 'claude',
  codex: 'codex'
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
  const [searchPanelId, setSearchPanelId] = useState<string | null>(null)

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
          ws.id === prev.activeWorkspaceId ? { ...ws, layout: { rows, cols } } : ws
        )
      }
    })
  }, [])

  const handleAddPanel = useCallback(
    async (config: Partial<PanelConfig>, folderToRemember?: string) => {
      if (!appState || !activeWorkspace) return

      const defaultShell = await window.electronAPI.getDefaultShell()
      const newId = `panel-${Date.now()}`
      const isAgent = config.agent === 'claude' || config.agent === 'codex'
      const defaultTitle =
        config.agent === 'claude' ? 'Claude Code' : config.agent === 'codex' ? 'Codex' : 'Shell'

      const newPanel: PanelConfig = {
        id: newId,
        title: config.title || defaultTitle,
        cwd: config.cwd || appState.lastUsedFolder || process.env.HOME || '/',
        agent: config.agent || 'none',
        agentCommand:
          config.agentCommand ||
          (isAgent
            ? appState.agentSettings?.[config.agent as 'claude' | 'codex']?.command ||
              AGENT_DEFAULT_COMMANDS[config.agent as AgentKind]
            : undefined),
        agentArgs:
          config.agentArgs ||
          (isAgent ? appState.agentSettings?.[config.agent as 'claude' | 'codex']?.args : undefined),
        shell: config.shell || defaultShell
      }

      // Only a panel created here auto-launches its agent (on its first spawn).
      if (isAgent) {
        terminalRegistry.markLaunchPending(newId)
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
            id: `panel-${Date.now()}-${idx}`,
            shell: p.shell || defaultShell
          }))
        : [
            {
              id: `panel-${Date.now()}-1`,
              title: 'Terminal 1',
              cwd: process.env.HOME || '/',
              agent: 'none',
              shell: defaultShell
            }
          ]

      const newWorkspace: WorkspaceConfig = {
        id: newWsId,
        name: name || `Workspace ${appState.workspaces.length + 1}`,
        layout: { rows: 1, cols: Math.min(initialPanels.length, 3) || 1 },
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
    searchPanelId,
    setSearchPanelId,
    setIsNewPanelModalOpen,
    setIsTemplateModalOpen,
    selectPanel: handleSelectPanel,
    toggleMaximize: handleToggleMaximize,
    setLayout: handleSetLayout,
    addPanel: handleAddPanel,
    removePanel: handleRemovePanel,
    updatePanel: handleUpdatePanel,
    switchWorkspace: handleSwitchWorkspace,
    createWorkspace: handleCreateWorkspace,
    launchAgent: handleRequestLaunch,
    restartAgent: handleRequestLaunch,
    focusNextUnread: handleFocusNextUnread
  }
}
