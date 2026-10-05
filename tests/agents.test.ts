import { describe, it, expect } from 'vitest'
import {
  AGENTS,
  AgentDetectionResult,
  AgentPresence,
  NO_AGENT,
  agentLabel,
  installedAgents,
  layoutForCount,
  presetLineup,
  promptFlag,
  rankedAgents,
  resolveAgentArgs,
  resolveAgentCommand,
  swarmPrompt
} from '../src/shared/agents'
import {
  defaultPromptAgent,
  isAutoChoice,
  promptableAgents,
  resolveCommandTarget
} from '../src/renderer/src/components/command-target'
import { PanelConfig } from '../src/shared/types'

function detection(presence: Record<string, AgentPresence>): AgentDetectionResult {
  return {
    shell: '/bin/zsh',
    agents: AGENTS.map((agent) => ({
      id: agent.id,
      command: agent.command,
      presence: presence[agent.id] ?? 'missing'
    }))
  }
}

describe('agent registry', () => {
  it('has unique ids and commands, and prompt flags the launch script accepts', () => {
    expect(new Set(AGENTS.map((a) => a.id)).size).toBe(AGENTS.length)
    expect(new Set(AGENTS.map((a) => a.command)).size).toBe(AGENTS.length)
    for (const agent of AGENTS) {
      const flag = promptFlag(agent.id)
      if (flag) expect(flag).toMatch(/^--?[A-Za-z][A-Za-z0-9-]*$/)
    }
    expect(promptFlag('claude')).toBe('')
    expect(promptFlag('gemini')).toBe('-i')
    expect(promptFlag('aider')).toBeUndefined()
    expect(promptFlag('custom')).toBeUndefined()
  })

  it('resolves commands and arguments from saved settings, else the defaults', () => {
    const settings = { claude: { command: ' /opt/claude ', args: '--verbose' }, codex: { command: '' } }
    expect(resolveAgentCommand('claude', settings)).toBe('/opt/claude')
    expect(resolveAgentCommand('codex', settings)).toBe('codex')
    expect(resolveAgentCommand('gemini', undefined)).toBe('gemini')
    expect(resolveAgentArgs('claude', settings)).toBe('--verbose')
    expect(resolveAgentArgs('goose', settings)).toBe('session')
    // A malformed entry (hand-edited state file) is ignored.
    expect(resolveAgentCommand('amp', { amp: 'amp2' } as never)).toBe('amp')
  })

  it('labels known, custom, future and shell panels', () => {
    expect(agentLabel({ agent: 'gemini' })).toBe('Gemini CLI')
    expect(agentLabel({ agent: 'custom', agentCommand: '/opt/tools/my-agent' })).toBe('my-agent')
    expect(agentLabel({ agent: 'future-agent' as never, agentCommand: 'future' })).toBe('future')
    expect(agentLabel({ agent: NO_AGENT })).toBe('Shell')
  })

  it('picks a grid for any panel count', () => {
    expect(layoutForCount(1)).toEqual({ rows: 1, cols: 1 })
    expect(layoutForCount(4)).toEqual({ rows: 2, cols: 2 })
    expect(layoutForCount(5)).toEqual({ rows: 2, cols: 3 })
    expect(layoutForCount(9)).toEqual({ rows: 3, cols: 3 })
  })
})

describe('agent ranking', () => {
  it('lists installed agents first, then shell functions, unchecked, missing', () => {
    const result = detection({ gemini: 'found', claude: 'shell', amp: 'unknown', codex: 'found' })
    expect(rankedAgents(result).slice(0, 4)).toEqual([
      { id: 'codex', presence: 'found' },
      { id: 'gemini', presence: 'found' },
      { id: 'claude', presence: 'shell' },
      { id: 'amp', presence: 'unknown' }
    ])
    expect(installedAgents(result)).toEqual(['codex', 'gemini', 'claude'])
  })

  it('treats every agent as unchecked before the first check', () => {
    expect(rankedAgents(null).every((e) => e.presence === 'unknown')).toBe(true)
    expect(installedAgents(null)).toEqual([])
  })
})

describe('presets', () => {
  it('fills slots from the installed agents, in turn', () => {
    expect(presetLineup('pair', ['codex', 'gemini']).map((s) => s.agent)).toEqual(['codex', 'gemini'])
    expect(presetLineup('pair', ['codex']).map((s) => s.agent)).toEqual(['codex', 'codex'])
    const bench = presetLineup('workbench', ['claude', 'codex', 'gemini', 'qwen'])
    expect(bench.map((s) => s.agent)).toEqual(['claude', 'codex', 'gemini', NO_AGENT])
  })

  it('falls back to Claude Code when nothing is installed', () => {
    expect(presetLineup('solo', [])).toEqual([{ agent: 'claude', title: 'Claude Code' }])
  })

  it('gives swarm members a role and puts the role before the task', () => {
    const swarm = presetLineup('swarm', ['claude', 'codex'])
    expect(swarm.map((s) => [s.agent, s.title])).toEqual([
      ['claude', 'Architect'],
      ['codex', 'Builder'],
      ['claude', 'Reviewer'],
      ['codex', 'Tester']
    ])
    expect(swarmPrompt(swarm[0].brief, '  fix the login bug ')).toBe(
      `${swarm[0].brief}\n\nTask: fix the login bug`
    )
    expect(swarmPrompt(swarm[0].brief, '   ')).toBeUndefined()
  })
})

describe('command bar target', () => {
  const panels = [
    { id: 'p1', title: 'One', cwd: '/', agent: 'claude', shell: '/bin/zsh' },
    { id: 'p2', title: 'Two', cwd: '/', agent: 'none', shell: '/bin/zsh' }
  ] as PanelConfig[]

  it('sends to the active panel while a program runs there', () => {
    for (const status of ['running', 'waiting', 'done'] as const) {
      expect(
        resolveCommandTarget({
          choice: 'auto',
          panels,
          activePanelId: 'p1',
          statuses: { p1: { status } },
          newAgent: 'codex'
        })
      ).toEqual({ kind: 'panel', panelId: 'p1' })
    }
  })

  it('starts the agent when nothing runs in the active panel', () => {
    for (const status of ['idle', 'exited', 'error', undefined] as const) {
      expect(
        resolveCommandTarget({
          choice: 'auto',
          panels,
          activePanelId: 'p2',
          statuses: status ? { p2: { status } } : {},
          newAgent: 'codex'
        })
      ).toEqual({ kind: 'new', agent: 'codex' })
    }
    expect(
      resolveCommandTarget({ choice: 'auto', panels: [], activePanelId: null, statuses: {}, newAgent: 'gemini' })
    ).toEqual({ kind: 'new', agent: 'gemini' })
  })

  it('sends to the active shell while a command typed by hand runs there', () => {
    const base = { choice: 'auto', panels, activePanelId: 'p2', statuses: { p2: { status: 'idle' as const } } }
    expect(resolveCommandTarget({ ...base, newAgent: 'codex', activeRunsCommand: true })).toEqual({
      kind: 'panel',
      panelId: 'p2'
    })
    expect(resolveCommandTarget({ ...base, newAgent: 'codex', activeRunsCommand: false })).toEqual({
      kind: 'new',
      agent: 'codex'
    })
    // An explicit new agent wins over a busy shell.
    expect(
      resolveCommandTarget({ ...base, choice: 'new:gemini', newAgent: 'codex', activeRunsCommand: true })
    ).toEqual({ kind: 'new', agent: 'gemini' })
  })

  it('treats a choice whose panel is gone as automatic', () => {
    expect(isAutoChoice('auto', panels)).toBe(true)
    expect(isAutoChoice('panel:p1', panels)).toBe(false)
    expect(isAutoChoice('panel:gone', panels)).toBe(true)
    expect(isAutoChoice('new:codex', panels)).toBe(false)
  })

  it('follows an explicit choice, and falls back when its panel is gone', () => {
    const base = { panels, activePanelId: 'p1', statuses: { p1: { status: 'running' as const } }, newAgent: 'codex' }
    expect(resolveCommandTarget({ ...base, choice: 'panel:p2' })).toEqual({ kind: 'panel', panelId: 'p2' })
    expect(resolveCommandTarget({ ...base, choice: 'new:gemini' })).toEqual({ kind: 'new', agent: 'gemini' })
    expect(resolveCommandTarget({ ...base, choice: 'panel:gone' })).toEqual({ kind: 'panel', panelId: 'p1' })
  })

  it('starts only agents that take a prompt and are not missing', () => {
    const result = detection({ aider: 'found', gemini: 'found', claude: 'unknown', codex: 'missing' })
    expect(promptableAgents(result)).toEqual(['gemini', 'claude'])
    expect(defaultPromptAgent(null, result)).toBe('gemini')
    expect(defaultPromptAgent('claude', result)).toBe('claude')
    // A remembered agent that is gone (or never took prompts) is not used.
    expect(defaultPromptAgent('codex', result)).toBe('gemini')
    expect(defaultPromptAgent('aider', result)).toBe('gemini')
    expect(defaultPromptAgent(null, detection({}))).toBe('claude')
  })
})
