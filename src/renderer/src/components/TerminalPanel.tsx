import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { PanelConfig, PanelStatus } from '../../../shared/types'
import { terminalRegistry } from '../terminal/terminals'
import { PanelHeader } from './PanelHeader'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

interface TerminalPanelProps {
  panel: PanelConfig
  projectName?: string
  isActive: boolean
  isMaximized: boolean
  isUnread?: boolean
  status?: PanelStatus
  statusDetail?: string
  isSearchOpen: boolean
  isHidden?: boolean
  onLaunchAgent?: () => void
  onRestartAgent?: () => void
  onSelect: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onAddPanel?: () => void
  onOpenMenu?: (e: React.MouseEvent) => void
  onToggleSearch?: () => void
  onUpdate?: (updates: Partial<PanelConfig>) => void
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  panel,
  projectName,
  isActive,
  isMaximized,
  isUnread,
  status = 'idle',
  statusDetail,
  isSearchOpen,
  isHidden,
  onLaunchAgent,
  onRestartAgent,
  onSelect,
  onToggleMaximize,
  onClose,
  onAddPanel,
  onOpenMenu,
  onToggleSearch,
  onUpdate
}) => {
  const slotRef = useRef<HTMLDivElement>(null)
  const [searchText, setSearchText] = useState('')

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    terminalRegistry.attach(panel.id, slot)
    return () => terminalRegistry.detach(panel.id, slot)
  }, [panel.id])

  useLayoutEffect(() => {
    terminalRegistry.setVisible(panel, !isHidden)
  }, [panel.id, isHidden])

  useEffect(() => {
    terminalRegistry.syncSpawnConfig(panel)
  }, [panel.id, panel.cwd, panel.shell])

  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    let lastFitTime = 0
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      const now = Date.now()
      const remaining = 100 - (now - lastFitTime)
      if (remaining <= 0) {
        if (trailingTimer) clearTimeout(trailingTimer)
        trailingTimer = null
        lastFitTime = now
        terminalRegistry.fit(panel.id)
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          lastFitTime = Date.now()
          trailingTimer = null
          terminalRegistry.fit(panel.id)
        }, remaining)
      }
    })
    ro.observe(slot)

    return () => {
      ro.disconnect()
      if (trailingTimer) clearTimeout(trailingTimer)
    }
  }, [panel.id])

  useEffect(() => {
    if (isActive) terminalRegistry.focus(panel.id)
  }, [isActive, panel.id])

  const handleSearchNext = useCallback(() => {
    if (searchText) terminalRegistry.findNext(panel.id, searchText)
  }, [panel.id, searchText])

  const handleSearchPrev = useCallback(() => {
    if (searchText) terminalRegistry.findPrevious(panel.id, searchText)
  }, [panel.id, searchText])

  // Determine border modifier class according to Section 2.4
  // Focused panel: 1px accent border. Panel waiting for input: waiting-border. Finished but unread: done-border.
  let borderClass = ''
  if (status === 'waiting') {
    borderClass = 'is-waiting'
  } else if (isUnread) {
    borderClass = 'is-done-unread'
  } else if (isActive) {
    borderClass = 'is-focused'
  }

  return (
    <div
      className={`terminal-panel-card terminal-panel ${borderClass} ${isActive ? 'active' : ''} ${isMaximized ? 'maximized' : ''}`}
      style={isHidden ? { display: 'none' } : undefined}
      data-panel-id={panel.id}
      onClick={onSelect}
    >
      <PanelHeader
        panel={panel}
        projectName={projectName}
        status={status}
        statusDetail={statusDetail}
        isUnread={isUnread}
        isMaximized={isMaximized}
        onSelect={onSelect}
        onOpenMenu={onOpenMenu}
        onToggleMaximize={onToggleMaximize}
        onAddPanel={onAddPanel}
        onClose={onClose}
        onLaunchAgent={onLaunchAgent}
        onRestartAgent={onRestartAgent}
        onUpdatePanel={onUpdate}
      />

      <div className="terminal-body-container">
        <div className="terminal-slot" ref={slotRef} />

        {/* In-Terminal Search Overlay */}
        {isSearchOpen && (
          <div className="terminal-search-bar" onClick={(e) => e.stopPropagation()}>
            <input
              placeholder="Search terminal..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) handleSearchPrev()
                  else handleSearchNext()
                } else if (e.key === 'Escape') {
                  onToggleSearch?.()
                }
              }}
              autoFocus
            />
            <button type="button" className="search-tool-btn" onClick={handleSearchPrev} title="Previous">
              <ChevronUp size={12} />
            </button>
            <button type="button" className="search-tool-btn" onClick={handleSearchNext} title="Next">
              <ChevronDown size={12} />
            </button>
            <button type="button" className="search-tool-btn" onClick={onToggleSearch} title="Close search">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
