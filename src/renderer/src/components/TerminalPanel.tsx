import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { PanelConfig, PanelStatus } from '../../../shared/types'
import { terminalRegistry } from '../terminal/terminals'
import { PanelHeader } from './PanelHeader'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

interface TerminalPanelProps {
  panel: PanelConfig
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
  onToggleSearch?: () => void
  onUpdate?: (updates: Partial<PanelConfig>) => void
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  panel,
  isActive,
  isMaximized,
  isUnread,
  status,
  statusDetail,
  isSearchOpen,
  isHidden,
  onLaunchAgent,
  onRestartAgent,
  onSelect,
  onToggleMaximize,
  onClose,
  onToggleSearch
}) => {
  // The terminal itself lives in the registry; this slot only hosts it while
  // the panel is mounted. Unmounting parks it, so the PTY keeps running.
  const slotRef = useRef<HTMLDivElement>(null)
  const [searchText, setSearchText] = useState('')

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    terminalRegistry.attach(panel.id, slot)
    return () => terminalRegistry.detach(panel.id, slot)
  }, [panel.id])

  // Hidden panels (behind a maximized one) give up their WebGL renderer and
  // stop rendering; the first show creates the session and spawns the PTY.
  useLayoutEffect(() => {
    terminalRegistry.setVisible(panel, !isHidden)
    // Only visibility changes matter here; panel fields are read at spawn time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, isHidden])

  // A changed cwd or shell respawns the PTY (agent fields never do).
  useEffect(() => {
    terminalRegistry.syncSpawnConfig(panel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, panel.cwd, panel.shell])

  // Debounced refit on window or layout resize.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => terminalRegistry.fit(panel.id), 50)
    })
    ro.observe(slot)

    return () => {
      ro.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [panel.id])

  // Focus terminal when panel becomes active
  useEffect(() => {
    if (isActive) terminalRegistry.focus(panel.id)
  }, [isActive, panel.id])

  const handleSearchNext = useCallback(() => {
    if (searchText) terminalRegistry.findNext(panel.id, searchText)
  }, [panel.id, searchText])

  const handleSearchPrev = useCallback(() => {
    if (searchText) terminalRegistry.findPrevious(panel.id, searchText)
  }, [panel.id, searchText])

  return (
    <div
      className={`terminal-panel ${isActive ? 'active' : ''} ${isUnread ? 'unread' : ''} ${
        isMaximized ? 'maximized' : ''
      }`}
      style={isHidden ? { display: 'none' } : undefined}
      data-panel-id={panel.id}
      onClick={onSelect}
    >
      <PanelHeader
        panel={panel}
        status={status}
        statusDetail={statusDetail}
        isUnread={isUnread}
        isMaximized={isMaximized}
        onSelect={onSelect}
        onLaunchAgent={onLaunchAgent}
        onRestartAgent={onRestartAgent}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
      />

      <div className="terminal-body">
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
            <button className="btn btn-sm btn-icon" onClick={handleSearchPrev} title="Previous">
              <ChevronUp size={12} />
            </button>
            <button className="btn btn-sm btn-icon" onClick={handleSearchNext} title="Next">
              <ChevronDown size={12} />
            </button>
            <button className="btn btn-sm btn-icon" onClick={onToggleSearch} title="Close search">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
