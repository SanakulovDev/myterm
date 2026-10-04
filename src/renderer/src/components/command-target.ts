import { PanelConfig, PanelStatus } from '../../../shared/types'
import { AgentDetectionResult, rankedAgents, supportsPrompt } from '../../../shared/agents'

/** Where a command bar prompt goes: a running panel, or a new agent panel. */
export type CommandTarget = { kind: 'panel'; panelId: string } | { kind: 'new'; agent: string }

/** The target select's values: automatic, one panel, or a new agent. */
export const AUTO_TARGET = 'auto'
export const panelTargetValue = (panelId: string): string => `panel:${panelId}`
export const newAgentTargetValue = (agent: string): string => `new:${agent}`

/** A program is up in the panel: an agent, or anything its hooks report on. */
export function isPanelBusy(status: PanelStatus | undefined): boolean {
  return status === 'running' || status === 'waiting' || status === 'done'
}

/**
 * Agents a prompt can start: launchable (not known to be missing) and able
 * to take a first prompt, best first.
 */
export function promptableAgents(detection: AgentDetectionResult | null | undefined): string[] {
  return rankedAgents(detection)
    .filter((entry) => entry.presence !== 'missing' && supportsPrompt(entry.id))
    .map((entry) => entry.id)
}

/** The agent a new prompt starts: the remembered one if it can, else the best one. */
export function defaultPromptAgent(
  remembered: string | null | undefined,
  detection: AgentDetectionResult | null | undefined
): string {
  const agents = promptableAgents(detection)
  if (remembered && agents.includes(remembered)) return remembered
  return agents[0] ?? 'claude'
}

/** Automatic, or an explicit choice that no longer applies (its panel is gone). */
export function isAutoChoice(choice: string, panels: readonly PanelConfig[]): boolean {
  if (choice.startsWith('new:')) return false
  if (!choice.startsWith('panel:')) return true
  const panelId = choice.slice('panel:'.length)
  return !panels.some((panel) => panel.id === panelId)
}

/**
 * Resolve the select's value. Automatic sends to the active panel while a
 * program runs in it, and otherwise starts `newAgent` with the prompt. A
 * panel that is gone counts as automatic.
 *
 * `activeRunsCommand` is main's answer for the active panel: a command runs
 * in its shell (an agent typed by hand has no status of its own).
 */
export function resolveCommandTarget(options: {
  choice: string
  panels: readonly PanelConfig[]
  activePanelId: string | null
  statuses: Record<string, { status: PanelStatus } | undefined>
  newAgent: string
  activeRunsCommand?: boolean
}): CommandTarget {
  const { choice, panels, activePanelId, statuses, newAgent, activeRunsCommand } = options
  if (!isAutoChoice(choice, panels)) {
    return choice.startsWith('new:')
      ? { kind: 'new', agent: choice.slice('new:'.length) }
      : { kind: 'panel', panelId: choice.slice('panel:'.length) }
  }
  const active = panels.find((panel) => panel.id === activePanelId)
  if (active && (activeRunsCommand || isPanelBusy(statuses[active.id]?.status))) {
    return { kind: 'panel', panelId: active.id }
  }
  return { kind: 'new', agent: newAgent }
}
