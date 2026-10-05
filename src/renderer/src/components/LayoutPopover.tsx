import React, { useEffect, useRef } from 'react'
import { LayoutMode, WorkspaceLayout } from '../../../shared/types'
import { GRID_PRESETS } from '../../../shared/layout'

interface LayoutPopoverProps {
  isOpen: boolean
  onClose: () => void
  layout: WorkspaceLayout
  onSelectMode: (mode: LayoutMode) => void
  onSelectPreset: (rows: number, cols: number) => void
}

export const LayoutPopover: React.FC<LayoutPopoverProps> = ({
  isOpen,
  onClose,
  layout,
  onSelectMode,
  onSelectPreset
}) => {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="layout-popover" ref={popoverRef} role="dialog" aria-label="Layout Options">
      {/* Segmented Control */}
      <div className="segmented-control" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={layout.mode === 'stack'}
          className={`segment-btn ${layout.mode === 'stack' ? 'active' : ''}`}
          onClick={() => onSelectMode('stack')}
        >
          Stack
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={layout.mode === 'grid'}
          className={`segment-btn ${layout.mode === 'grid' ? 'active' : ''}`}
          onClick={() => onSelectMode('grid')}
        >
          Grid
        </button>
      </div>

      {/* Grid presets */}
      <div className="layout-presets-section">
        <span className="layout-section-label">PRESETS</span>
        <div className="presets-row">
          {GRID_PRESETS.map((preset) => {
            const isSelected =
              layout.mode === 'grid' && layout.rows === preset.rows && layout.cols === preset.cols
            return (
              <button
                key={`${preset.rows}x${preset.cols}`}
                type="button"
                className={`preset-btn ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectPreset(preset.rows, preset.cols)}
                title={`${preset.rows}×${preset.cols} Grid`}
              >
                {preset.rows}×{preset.cols}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
