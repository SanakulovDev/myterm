import type { AgentSettings, PanelConfig } from './types'

// Every coding agent CLI the app knows by name. A panel stores the agent's id
// (PanelConfig.agent); the command and default arguments can be overridden per
// agent in AppState.agentSettings. Anything else runs as a 'custom' command.

/**
 * How an agent takes a first prompt while staying interactive:
 * - 'positional': `<command> [args] -- "<prompt>"`
 * - a flag such as '-i': `<command> [args] -i "<prompt>"`
 * - null: it cannot; it starts without one.
 * Flags were checked against each CLI's --help (claude 2.x, codex, gemini,
 * opencode, cursor-agent and copilot). Non-interactive flags (-p, exec) are
 * never used: the agent must stay open in its panel.
 */
export type PromptStyle = 'positional' | `-${string}` | null

export interface AgentDefinition {
  id: string
  name: string
  /** The binary looked up in the login shell's PATH. */
  command: string
  /** Arguments every launch starts with (e.g. a subcommand). */
  defaultArgs: string
  promptStyle: PromptStyle
  /** A shell command that installs it, shown (never run) for missing agents. */
  install: string
  homepage: string
  /** Badge colour. */
  color: string
}

export const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    defaultArgs: '',
    promptStyle: 'positional',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code',
    color: '#e3b341'
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    defaultArgs: '',
    promptStyle: 'positional',
    install: 'npm install -g @openai/codex',
    homepage: 'https://github.com/openai/codex',
    color: '#d2a8ff'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    defaultArgs: '',
    promptStyle: '-i',
    install: 'npm install -g @google/gemini-cli',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    color: '#79c0ff'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    defaultArgs: '',
    promptStyle: '--prompt',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    homepage: 'https://opencode.ai',
    color: '#c9d1d9'
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    defaultArgs: '',
    promptStyle: 'positional',
    install: 'curl https://cursor.com/install -fsS | bash',
    homepage: 'https://cursor.com/cli',
    color: '#a5d6ff'
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    command: 'copilot',
    defaultArgs: '',
    promptStyle: '-i',
    install: 'npm install -g @github/copilot',
    homepage: 'https://github.com/github/copilot-cli',
    color: '#7ee787'
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    defaultArgs: '',
    promptStyle: null,
    install: 'npm install -g @sourcegraph/amp',
    homepage: 'https://ampcode.com',
    color: '#ff7b72'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    command: 'qwen',
    defaultArgs: '',
    promptStyle: '-i',
    install: 'npm install -g @qwen-code/qwen-code',
    homepage: 'https://github.com/QwenLM/qwen-code',
    color: '#bc8cff'
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    defaultArgs: '',
    promptStyle: null,
    install: 'python -m pip install aider-install && aider-install',
    homepage: 'https://aider.chat',
    color: '#56d364'
  },
  {
    id: 'crush',
    name: 'Crush',
    command: 'crush',
    defaultArgs: '',
    promptStyle: null,
    install: 'brew install charmbracelet/tap/crush',
    homepage: 'https://github.com/charmbracelet/crush',
    color: '#f778ba'
  },
  {
    id: 'droid',
    name: 'Droid',
    command: 'droid',
    defaultArgs: '',
    promptStyle: null,
    install: 'curl -fsSL https://app.factory.ai/cli | sh',
    homepage: 'https://factory.ai',
    color: '#ffa657'
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose',
    defaultArgs: 'session',
    promptStyle: null,
    install:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    homepage: 'https://block.github.io/goose',
    color: '#e6edf3'
  }
] as const satisfies readonly AgentDefinition[]

export type KnownAgentId = (typeof AGENTS)[number]['id']

/** A panel's own command line, not one of the known agents. */
export const CUSTOM_AGENT = 'custom'
/** A plain shell panel. */
export const NO_AGENT = 'none'

export const CUSTOM_AGENT_COLOR = '#56d364'

// The longest first prompt passed on a command line (it travels in the
// environment of the launch shell, which macOS limits to about 1 MB in all).
export const MAX_PROMPT_LENGTH = 32_000

const BY_ID = new Map<string, AgentDefinition>(AGENTS.map((agent) => [agent.id, agent]))

export function getAgent(id: string | undefined): AgentDefinition | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function isAgentPanel(panel: Pick<PanelConfig, 'agent'>): boolean {
  return !!panel.agent && panel.agent !== NO_AGENT
}

function commandBaseName(command: string | undefined): string {
  const trimmed = command?.trim() ?? ''
  return trimmed.split('/').pop() || trimmed
}

/** The name shown for a panel's agent: 'Shell', the agent's name, or the command. */
export function agentLabel(panel: Pick<PanelConfig, 'agent' | 'agentCommand'>): string {
  if (!isAgentPanel(panel)) return 'Shell'
  const agent = getAgent(panel.agent)
  if (agent) return agent.name
  // Custom panels, and agents saved by a newer version of the app.
  return commandBaseName(panel.agentCommand) || panel.agent
}

export function agentColor(id: string | undefined): string {
  return getAgent(id)?.color ?? CUSTOM_AGENT_COLOR
}

type SettingsLike = Partial<AgentSettings> | Record<string, unknown> | undefined

function settingFor(settings: SettingsLike, id: string): { command?: unknown; args?: unknown } {
  const entry = (settings as Record<string, unknown> | undefined)?.[id]
  return typeof entry === 'object' && entry !== null ? (entry as { command?: unknown; args?: unknown }) : {}
}

/** The command a new panel of agent `id` runs: the saved override, else the default. */
export function resolveAgentCommand(id: string, settings: SettingsLike): string {
  const saved = settingFor(settings, id).command
  if (typeof saved === 'string' && saved.trim()) return saved.trim()
  return getAgent(id)?.command ?? ''
}

/** The arguments a new panel of agent `id` starts with. */
export function resolveAgentArgs(id: string, settings: SettingsLike): string {
  const saved = settingFor(settings, id).args
  if (typeof saved === 'string' && saved.trim()) return saved.trim()
  return getAgent(id)?.defaultArgs ?? ''
}

export function supportsPrompt(id: string | undefined): boolean {
  return (getAgent(id)?.promptStyle ?? null) !== null
}

/**
 * The flag placed before a first prompt: '' for a positional prompt (the
 * launch script puts it after `--`), undefined when the agent cannot take one.
 */
export function promptFlag(id: string | undefined): string | undefined {
  const style = getAgent(id)?.promptStyle ?? null
  if (style === null) return undefined
  return style === 'positional' ? '' : style
}

/** Rows x columns of the grid that shows `count` panels. */
export function layoutForCount(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 }
  if (count === 2) return { rows: 1, cols: 2 }
  if (count === 3) return { rows: 1, cols: 3 }
  if (count === 4) return { rows: 2, cols: 2 }
  if (count <= 6) return { rows: 2, cols: 3 }
  return { rows: 3, cols: 3 }
}

// ---------------------------------------------------------------------------
// Agent detection (main runs it in the login shell; see main/agent-detect.ts)

/**
 * - found: an executable of that name is in the login shell's PATH
 * - shell: only a shell function, alias or builtin answers to the name
 * - missing: nothing does
 * - unknown: the check could not run (timeout, broken shell rc)
 */
export type AgentPresence = 'found' | 'shell' | 'missing' | 'unknown'

export interface AgentDetectionEntry {
  id: string
  command: string
  presence: AgentPresence
  /** The executable, for presence 'found'. */
  path?: string
}

export interface AgentDetectionResult {
  /** The shell the check ran in. */
  shell: string
  agents: AgentDetectionEntry[]
  /** Why the check failed; every presence is 'unknown' then. */
  error?: string
}

/** Launchable as far as the app can tell (an unknown result is not held against it). */
export function isLaunchable(presence: AgentPresence | undefined): boolean {
  return presence !== 'missing'
}

const PRESENCE_RANK: Record<AgentPresence, number> = { found: 0, shell: 1, unknown: 2, missing: 3 }

/**
 * Every known agent with its presence, best first: installed executables,
 * shell functions, unchecked, then missing; registry order within each.
 * Before the first check every agent is 'unknown'.
 */
export function rankedAgents(
  detection: AgentDetectionResult | null | undefined
): { id: string; presence: AgentPresence }[] {
  const byId = new Map(detection?.agents.map((entry) => [entry.id, entry.presence]))
  return AGENTS.map((agent) => ({ id: agent.id, presence: byId.get(agent.id) ?? ('unknown' as const) }))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => PRESENCE_RANK[a.entry.presence] - PRESENCE_RANK[b.entry.presence] || a.index - b.index)
    .map(({ entry }) => entry)
}

/** Agents the check confirmed (an executable or a shell function), best first. */
export function installedAgents(detection: AgentDetectionResult | null | undefined): string[] {
  return rankedAgents(detection)
    .filter((entry) => entry.presence === 'found' || entry.presence === 'shell')
    .map((entry) => entry.id)
}

// ---------------------------------------------------------------------------
// Launch presets

export type PresetId = 'solo' | 'pair' | 'workbench' | 'swarm'

export interface LineupSlot {
  /** An agent id, or NO_AGENT for a plain shell. */
  agent: string
  title: string
  /** Swarm only: the role's standing instructions, sent with the task. */
  brief?: string
}

export interface PresetDefinition {
  id: PresetId
  name: string
  description: string
  maxSlots: number
}

export const PRESETS: readonly PresetDefinition[] = [
  { id: 'solo', name: 'Solo', description: 'One agent.', maxSlots: 1 },
  { id: 'pair', name: 'Pair', description: 'Two agents side by side.', maxSlots: 2 },
  {
    id: 'workbench',
    name: 'Workbench',
    description: 'Several agents and a shell for builds and tests.',
    maxSlots: 9
  },
  {
    id: 'swarm',
    name: 'Swarm',
    description: 'Agents with roles. A task, if given, goes to each with its role.',
    maxSlots: 9
  }
]

export const SWARM_ROLES: readonly { title: string; brief: string }[] = [
  {
    title: 'Architect',
    brief:
      'You are the architect in a team of coding agents working in this folder. ' +
      'Study the code, plan the work and split it into steps. Do not edit files.'
  },
  {
    title: 'Builder',
    brief:
      'You are the builder in a team of coding agents working in this folder. ' +
      'Implement the task with small, focused changes.'
  },
  {
    title: 'Reviewer',
    brief:
      'You are the reviewer in a team of coding agents working in this folder. ' +
      'Review the current changes (git diff) for bugs and risks. Do not edit files.'
  },
  {
    title: 'Tester',
    brief:
      'You are the tester in a team of coding agents working in this folder. ' +
      'Write and run tests for the task and report failures.'
  }
]

/**
 * The starting lineup of a preset, from the agents available (best first).
 * With no agent available, agent slots fall back to the first known agent.
 */
export function presetLineup(preset: PresetId, available: readonly string[]): LineupSlot[] {
  const pool = available.length > 0 ? available : [AGENTS[0].id]
  const pick = (index: number): string => pool[index % pool.length]
  const slot = (agent: string): LineupSlot => ({ agent, title: getAgent(agent)?.name ?? agent })
  switch (preset) {
    case 'solo':
      return [slot(pick(0))]
    case 'pair':
      return [slot(pick(0)), slot(pick(1))]
    case 'workbench': {
      const agents = pool.slice(0, 3).map(slot)
      return [...agents, { agent: NO_AGENT, title: 'Shell' }]
    }
    case 'swarm':
      return SWARM_ROLES.map((role, index) => ({ agent: pick(index), title: role.title, brief: role.brief }))
  }
}

/** The first prompt of a swarm member: its role, then the task. */
export function swarmPrompt(brief: string | undefined, task: string): string | undefined {
  const trimmed = task.trim()
  if (!trimmed) return undefined
  return brief ? `${brief}\n\nTask: ${trimmed}` : trimmed
}
