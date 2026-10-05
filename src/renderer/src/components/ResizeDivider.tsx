import React, { useState, useRef, useCallback } from 'react'

export interface ResizeDividerProps {
  orientation: 'horizontal' | 'vertical'
  onResize: (deltaPx: number) => void
  onResizeEnd?: () => void
  onReset?: () => void
  label?: string
  className?: string
  style?: React.CSSProperties
}

export const ResizeDivider: React.FC<ResizeDividerProps> = ({
  orientation,
  onResize,
  onResizeEnd,
  onReset,
  label,
  className = '',
  style
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const lastPosRef = useRef<number>(0)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      lastPosRef.current = orientation === 'vertical' ? e.clientX : e.clientY
      setIsDragging(true)
      document.body.classList.add('is-resizing')
    },
    [orientation]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      e.preventDefault()
      e.stopPropagation()
      const currentPos = orientation === 'vertical' ? e.clientX : e.clientY
      const delta = currentPos - lastPosRef.current
      if (delta !== 0) {
        lastPosRef.current = currentPos
        onResize(delta)
      }
    },
    [isDragging, onResize, orientation]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      e.preventDefault()
      e.stopPropagation()
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // Pointer capture may have already been released
      }
      setIsDragging(false)
      document.body.classList.remove('is-resizing')
      onResizeEnd?.()
    },
    [isDragging, onResizeEnd]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 30 : 10

      if (orientation === 'vertical') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onResize(-step)
          onResizeEnd?.()
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onResize(step)
          onResizeEnd?.()
        }
      } else {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          onResize(-step)
          onResizeEnd?.()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          onResize(step)
          onResizeEnd?.()
        }
      }

      if (e.key === 'Enter' || e.key === ' ' || e.key === 'r') {
        e.preventDefault()
        onReset?.()
      }
    },
    [onResize, onResizeEnd, onReset, orientation]
  )

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label ?? (orientation === 'vertical' ? 'Resize columns' : 'Resize rows')}
      title="Drag to resize · double-click to reset"
      className={`resize-divider resize-divider-${orientation} ${isDragging ? 'is-dragging' : ''} ${className}`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onReset?.()
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="resize-grip" aria-hidden="true" />
      {isDragging && (
        <span className="resize-drag-hint" aria-hidden="true">
          Drag to resize · double-click to reset
        </span>
      )}
    </div>
  )
}
