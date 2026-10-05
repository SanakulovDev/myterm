import React, { useEffect, useCallback, useRef, useState } from 'react'
import { useAppStore } from './state/useAppStore'
import { WorkspaceGrid } from './components/WorkspaceGrid'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { LayoutPopover } from './components/LayoutPopover'
import { NewPanelModal } from './components/NewPanelModal'
import { TemplateModal } from './components/TemplateModal'
import { AgentLaunchModal } from './components/AgentLaunchModal'
import { CommandBar } from './components/CommandBar'
import { ResizeDivider } from './components/ResizeDivider'
import { DEFAULT_UI_STATE } from '../../shared/layout'
import { terminalRegistry } from './terminal/terminals'

export const App: React.FC = () => {
  const {
    appState,
    activeWorkspace,
    activePanelId,
    maximizedPanelId,
    panelStatuses,
    agentSettings,
    lastUsedFolder,
    isNewPanelModalOpen,
    isTemplateModalOpen,
    isLaunchModalOpen,
    searchPanelId,
    agentDetection,
    isDetectingAgents,
    missingPaths,
    isSidebarVisible,
    sidebarWidth,
    collapsedWorkspaceIds,
    theme,
    themeLabel,
    cycleTheme,
    refreshAgents,
    setSearchPanelId,
    setIsNewPanelModalOpen,
    setIsTemplateModalOpen,
    setIsLaunchModalOpen,
    selectPanel,
    toggleMaximize,
    setLayout: _setLayout,
    setLayoutMode,
    setLayoutGridPreset,
    updateLayout,
    setSidebarWidth,
    toggleSidebar,
    toggleWorkspaceCollapse,
    addPanel,
    removePanel,
    updatePanel,
    switchWorkspace,
    createWorkspace,
    launchLineup,
    sendPrompt,
    startAgentWithPrompt,
    launchAgent,
    restartAgent,
    focusNextUnread
  } = useAppStore()

  const [isLayoutPopoverOpen, setIsLayoutPopoverOpen] = useState(false)
  const commandInputRef = useRef<HTMLTextAreaElement>(null)

  // Calculate total unread count for header badge
  const totalUnread = activeWorkspace
    ? activeWorkspace.panels.filter((p) => panelStatuses[p.id]?.unread).length
    : 0

  // Keyboard shortcut listener (Section 7)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey

      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'n') {
        e.preventDefault()
        setIsNewPanelModalOpen(true)
        return
      }

      // Focus the command bar. Inside a terminal xterm.js takes Ctrl+L (clear
      // screen) itself, so only Cmd+L reaches this there.
      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'l') {
        e.preventDefault()
        commandInputRef.current?.focus()
        return
      }

      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'w') {
        if (activePanelId) {
          e.preventDefault()
          removePanel(activePanelId)
        }
        return
      }

      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault()
        toggleMaximize()
        return
      }

      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'u') {
        e.preventDefault()
        focusNextUnread()
        return
      }

      if (isCmd && !e.shiftKey && !e.altKey && e.key === 'f') {
        if (activePanelId) {
          e.preventDefault()
          setSearchPanelId((curr) => (curr === activePanelId ? null : activePanelId))
        }
        return
      }

      // Cmd+1...9 focus panel
      if (isCmd && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const index = parseInt(e.key, 10) - 1
        if (activeWorkspace && activeWorkspace.panels[index]) {
          e.preventDefault()
          selectPanel(activeWorkspace.panels[index].id)
        }
        return
      }

      // Cmd+Shift+[ and Cmd+Shift+] to switch workspaces
      if (isCmd && e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault()
        if (appState && appState.workspaces.length > 1) {
          const idx = appState.workspaces.findIndex((w) => w.id === appState.activeWorkspaceId)
          const prevIdx = (idx - 1 + appState.workspaces.length) % appState.workspaces.length
          switchWorkspace(appState.workspaces[prevIdx].id)
        }
        return
      }

      if (isCmd && e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault()
        if (appState && appState.workspaces.length > 1) {
          const idx = appState.workspaces.findIndex((w) => w.id === appState.activeWorkspaceId)
          const nextIdx = (idx + 1) % appState.workspaces.length
          switchWorkspace(appState.workspaces[nextIdx].id)
        }
        return
      }

      // Move focus with Cmd+Option+Arrow
      if (isCmd && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        if (activeWorkspace && activeWorkspace.panels.length > 1) {
          e.preventDefault()
          const idx = activeWorkspace.panels.findIndex((p) => p.id === activePanelId)
          const step = e.key === 'ArrowRight' ? 1 : -1
          const nextIdx = (idx + step + activeWorkspace.panels.length) % activeWorkspace.panels.length
          selectPanel(activeWorkspace.panels[nextIdx].id)
        }
        return
      }
    },
    [
      activePanelId,
      activeWorkspace,
      appState,
      focusNextUnread,
      removePanel,
      selectPanel,
      setIsNewPanelModalOpen,
      setSearchPanelId,
      switchWorkspace,
      toggleMaximize
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  if (!appState || !activeWorkspace) {
    return (
      <div className="empty-state" style={{ height: '100vh' }}>
        <span>Loading Agent Terminal...</span>
      </div>
    )
  }

  const activePanelCwd = activeWorkspace.panels.find((p) => p.id === activePanelId)?.cwd || '/'

  return (
    <div className="app-container">
      {/* Title Bar (Section 2.1) */}
      <TitleBar
        projectName={activeWorkspace.name}
        panelName={activeWorkspace.panels.find((p) => p.id === activePanelId)?.title}
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={toggleSidebar}
        onToggleLayout={() => setIsLayoutPopoverOpen((v) => !v)}
        isLayoutOpen={isLayoutPopoverOpen}
        hasAttention={
          totalUnread > 0 || Object.values(panelStatuses).some((s) => s.status === 'waiting')
        }
        onOpenNotifications={focusNextUnread}
        onOpenSettings={() => {}}
      />

      {/* Layout Popover (Section 2.3) */}
      <LayoutPopover
        isOpen={isLayoutPopoverOpen}
        onClose={() => setIsLayoutPopoverOpen(false)}
        layout={activeWorkspace.layout || { mode: 'stack', rows: 1, cols: 2 }}
        onSelectMode={(mode) => setLayoutMode(mode)}
        onSelectPreset={(rows, cols) => {
          setLayoutGridPreset(rows, cols)
          setIsLayoutPopoverOpen(false)
        }}
      />

      {/* Main Layout Shell */}
      <div className="main-layout-shell">
        {/* Floating Sidebar Card (Section 2.2) */}
        {isSidebarVisible && (
          <>
            <Sidebar
              workspaces={appState.workspaces}
              activeWorkspaceId={appState.activeWorkspaceId}
              activePanelId={activePanelId}
              panelStatuses={panelStatuses}
              collapsedWorkspaceIds={collapsedWorkspaceIds}
              missingPaths={missingPaths}
              onSwitchWorkspace={switchWorkspace}
              onCreateWorkspace={() => createWorkspace('')}
              onToggleCollapse={toggleWorkspaceCollapse}
              onSelectPanel={(panelId, wsId) => {
                if (wsId !== appState.activeWorkspaceId) switchWorkspace(wsId)
                selectPanel(panelId)
              }}
              onCycleTheme={cycleTheme}
              theme={theme}
              themeLabel={themeLabel}
              width={sidebarWidth}
            />
            <ResizeDivider
              orientation="vertical"
              onResize={(deltaPx) => setSidebarWidth(sidebarWidth + deltaPx)}
              onResizeEnd={() => terminalRegistry.fitAll()}
              onReset={() => setSidebarWidth(DEFAULT_UI_STATE.sidebarWidth)}
              label="Resize sidebar"
            />
          </>
        )}

        {/* Workspace Column: Stack or Grid */}
        <div className="workspace-column">
          <WorkspaceGrid
            workspace={activeWorkspace}
            activePanelId={activePanelId}
            maximizedPanelId={maximizedPanelId}
            panelStatuses={panelStatuses}
            searchPanelId={searchPanelId}
            onSelectPanel={selectPanel}
            onToggleMaximize={toggleMaximize}
            onClosePanel={removePanel}
            onLaunchAgent={launchAgent}
            onRestartAgent={restartAgent}
            onToggleSearch={(id) => setSearchPanelId((curr) => (curr === id ? null : id))}
            onUpdatePanel={updatePanel}
            onAddNewPanel={() => setIsNewPanelModalOpen(true)}
            onUpdateLayout={updateLayout}
          />
          <CommandBar
            workspace={activeWorkspace}
            activePanelId={activePanelId}
            panelStatuses={panelStatuses}
            detection={agentDetection}
            inputRef={commandInputRef}
            onSendPrompt={sendPrompt}
            onStartAgent={startAgentWithPrompt}
          />
        </div>

        {/* Reserved right slot (Section 2.9, empty/hidden until Phase D1) */}
        <div className="reserved-right-slot" style={{ display: 'none' }} aria-hidden="true" />
      </div>

      {/* Action triggers for New Panel and Multi-Agent Lineup Launch */}
      <button
        type="button"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}
        data-open-new-panel
        onClick={() => setIsNewPanelModalOpen(true)}
        aria-hidden="true"
        tabIndex={-1}
      >
        New Panel
      </button>
      <button
        type="button"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}
        data-open-launch
        onClick={() => setIsLaunchModalOpen(true)}
        aria-hidden="true"
        tabIndex={-1}
      >
        Launch
      </button>

      {/* Modals */}
      <NewPanelModal
        isOpen={isNewPanelModalOpen}
        defaultCwd={activePanelCwd}
        lastUsedFolder={lastUsedFolder}
        agentSettings={agentSettings}
        detection={agentDetection}
        isDetecting={isDetectingAgents}
        onRefreshAgents={() => void refreshAgents(true)}
        onClose={() => setIsNewPanelModalOpen(false)}
        onCreate={(panel, folder, options) => void addPanel(panel, folder, options)}
      />

      <AgentLaunchModal
        isOpen={isLaunchModalOpen}
        defaultCwd={lastUsedFolder || activePanelCwd}
        detection={agentDetection}
        onClose={() => setIsLaunchModalOpen(false)}
        onLaunch={(name, cwd, lineup) => void launchLineup(name, cwd, lineup)}
      />

      <TemplateModal
        isOpen={isTemplateModalOpen}
        activeWorkspace={activeWorkspace}
        onClose={() => setIsTemplateModalOpen(false)}
        onApplyTemplate={(name, panels) => createWorkspace(name, panels)}
      />
    </div>
  )
}
