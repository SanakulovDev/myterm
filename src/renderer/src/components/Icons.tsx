import React from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string
  strokeWidth?: number
}

const baseProps = (size: number | string = 16, strokeWidth = 1.8) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export const SidebarToggleIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
)

export const LayoutIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 12h18" />
    <path d="M12 12v9" />
  </svg>
)

export const BellIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export const SettingsIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const PlusIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const FolderPlusIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    <line x1="12" y1="10" x2="12" y2="16" />
    <line x1="9" y1="13" x2="15" y2="13" />
  </svg>
)

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

export const WarningTriangleIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

export const SparkleIcon: React.FC<IconProps> = ({ size = 13, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </svg>
)

export const MoreIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
    <circle cx="5" cy="12" r="1.5" />
  </svg>
)

export const MaximizeIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

export const MinimizeIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)

export const CloseIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

export const EditIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

export const WandIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
    <path d="m14 7 3 3" />
    <path d="M5 6v4" />
    <path d="M19 14v4" />
    <path d="M10 2v2" />
    <path d="M7 8H3" />
    <path d="M21 16h-4" />
    <path d="M11 3H9" />
  </svg>
)


export const PlayIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

export const RotateCcwIcon: React.FC<IconProps> = ({ size = 14, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
)

export const SunMoonIcon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
)

export const ShellIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
)

export const ClaudeMarkIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 15a5 5 0 1 1 5-5 5 5 0 0 1-5 5z" />
  </svg>
)

export const CodexMarkIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6" />
    <path d="m15 9-6 6" />
  </svg>
)

export const BotMarkIcon: React.FC<IconProps> = ({ size = 15, strokeWidth = 1.8, ...props }) => (
  <svg {...baseProps(size, strokeWidth)} {...props}>
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

export const AgentIcon: React.FC<{ agent?: string; size?: number; className?: string; style?: React.CSSProperties }> = ({
  agent = 'none',
  size = 15,
  className,
  style
}) => {
  if (agent === 'claude') {
    return <ClaudeMarkIcon size={size} className={className} style={{ color: 'var(--agent-claude)', ...style }} />
  }
  if (agent === 'codex') {
    return <CodexMarkIcon size={size} className={className} style={{ color: 'var(--agent-codex)', ...style }} />
  }
  if (agent === 'none' || agent === 'shell') {
    return <ShellIcon size={size} className={className} style={{ color: 'var(--agent-shell)', ...style }} />
  }
  return <BotMarkIcon size={size} className={className} style={{ color: 'var(--accent)', ...style }} />
}
