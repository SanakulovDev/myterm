import React, { useEffect, useCallback } from 'react'
import { useAppStore } from './state/useAppStore'
import { WorkspaceGrid } from './components/WorkspaceGrid'
import { Sidebar } from './components/Sidebar'
import { NewPanelModal } from './components/NewPanelModal'
import { TemplateModal } from './components/TemplateModal'
import { Plus, Bell, Bookmark } from 'lucide-react'

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
    searchPanelId,
    setSearchPanelId,
    setIsNewPanelModalOpen,
    setIsTemplateModalOpen,
    selectPanel,
    toggleMaximize,
    setLayout,
    addPanel,
    removePanel,
    updatePanel,
    switchWorkspace,
    createWorkspace,
    launchAgent,
    restartAgent,
    focusNextUnread
  } = useAppStore()

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

  return (
    <div className="app-container">
      {/* Title Bar */}
      <header className="titlebar">
        <div className="titlebar-center">
          <span>Agent Terminal</span>
          <span style={{ color: 'var(--text-muted)' }}>—</span>
          <span style={{ color: 'var(--text-secondary)' }}>{activeWorkspace.name}</span>
        </div>

        <div className="titlebar-actions">
          {totalUnread > 0 && (
            <button
              className="btn btn-sm"
              onClick={focusNextUnread}
              style={{ background: '#d2992226', color: '#e3b341', borderColor: 'rgba(210,153,34,0.4)' }}
              title="Next unread panel (Cmd+U)"
            >
              <Bell size={12} />
              <span>{totalUnread} waiting</span>
            </button>
          )}

          <button
            className="btn btn-sm"
            onClick={() => setIsTemplateModalOpen(true)}
            title="Workspace templates"
          >
            <Bookmark size={12} />
            <span>Templates</span>
          </button>

          <button
            className="btn btn-sm btn-primary"
            onClick={() => setIsNewPanelModalOpen(true)}
            title="Add panel (Cmd+N)"
          >
            <Plus size={12} />
            <span>New Panel</span>
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="main-layout">
        <Sidebar
          workspaces={appState.workspaces}
          activeWorkspaceId={appState.activeWorkspaceId}
          activeWorkspace={activeWorkspace}
          activePanelId={activePanelId}
          panelStatuses={panelStatuses}
          onSwitchWorkspace={switchWorkspace}
          onCreateWorkspace={() => createWorkspace('')}
          onSetLayout={setLayout}
          onSelectPanel={selectPanel}
          onOpenTemplates={() => setIsTemplateModalOpen(true)}
        />

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
        />
      </div>

      {/* Modals */}
      <NewPanelModal
        isOpen={isNewPanelModalOpen}
        defaultCwd={
          activeWorkspace.panels.find((p) => p.id === activePanelId)?.cwd ||
          process.env.HOME ||
          '/'
        }
        lastUsedFolder={lastUsedFolder}
        agentSettings={agentSettings}
        onClose={() => setIsNewPanelModalOpen(false)}
        onCreate={addPanel}
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
