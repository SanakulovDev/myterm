import React, { useEffect, useRef } from 'react'
import { PanelConfig } from '../../../shared/types'
import { isAgentPanel } from '../../../shared/agents'
import {
  EditIcon,
  SparkleIcon,
  WandIcon,
  MaximizeIcon,
  MinimizeIcon,
  CloseIcon
} from './Icons'

interface PanelMenuPopoverProps {
  isOpen: boolean
  anchorRect: DOMRect | null
  panel: PanelConfig
  isMaximized: boolean
  onClose: () => void
  onStartRename: () => void
  onToggleAutoName: () => void
  onGenerateName: () => void
  onToggleMaximize: () => void
  onClosePanel: () => void
}

export const PanelMenuPopover: React.FC<PanelMenuPopoverProps> = ({
  isOpen,
  anchorRect,
  panel,
  isMaximized,
  onClose,
  onStartRename,
  onToggleAutoName,
  onGenerateName,
  onToggleMaximize,
  onClosePanel
}) => {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen || !anchorRect) return null

  const isAgent = isAgentPanel(panel)
  const isAutoNamed = panel.autoName !== false && isAgent

  // Calculate position: anchor below button, aligned right with edge of button
  const top = anchorRect.bottom + 6
  let right = window.innerWidth - anchorRect.right
  if (right < 12) right = 12

  return (
    <div
      ref={popoverRef}
      className="panel-menu-popover"
      style={{
        position: 'fixed',
        top: `${top}px`,
        right: `${right}px`,
        width: '244px',
        zIndex: 100
      }}
      role="menu"
      aria-label="Panel Actions"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Rename */}
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        onClick={() => {
          onClose()
          onStartRename()
        }}
      >
        <span className="menu-item-icon">
          <EditIcon size={14} />
        </span>
        <span className="menu-item-label">Rename</span>
      </button>

      {/* 2. Auto-name with toggle switch */}
      <div
        className="menu-item menu-item-toggle"
        role="menuitemcheckbox"
        aria-checked={isAutoNamed}
        tabIndex={0}
        onClick={() => {
          onToggleAutoName()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleAutoName()
          }
        }}
      >
        <div className="menu-item-left">
          <span className="menu-item-icon">
            <SparkleIcon size={14} />
          </span>
          <span className="menu-item-label">Auto-name</span>
        </div>
        <div className={`switch-toggle ${isAutoNamed ? 'active' : ''}`} aria-hidden="true">
          <div className="switch-thumb" />
        </div>
      </div>

      {/* 3. Generate a new name (active for agents) */}
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        disabled={!isAgent}
        onClick={() => {
          onClose()
          onGenerateName()
        }}
      >
        <span className="menu-item-icon">
          <WandIcon size={14} />
        </span>
        <span className="menu-item-label">Generate a new name</span>
      </button>

      {/* Separator */}
      <div className="menu-separator" role="separator" />

      {/* 4. Maximize / Restore */}
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        onClick={() => {
          onClose()
          onToggleMaximize()
        }}
      >
        <span className="menu-item-icon">
          {isMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
        </span>
        <span className="menu-item-label">{isMaximized ? 'Restore panel' : 'Maximize'}</span>
      </button>

      {/* 5. Close panel (status-error text color) */}
      <button
        type="button"
        className="menu-item menu-item-danger"
        role="menuitem"
        onClick={() => {
          onClose()
          onClosePanel()
        }}
      >
        <span className="menu-item-icon">
          <CloseIcon size={14} />
        </span>
        <span className="menu-item-label">Close panel</span>
      </button>
    </div>
  )
}
