import { describe, it, expect, vi } from 'vitest'
import { AgentTracker } from '../src/main/agent-tracker'

describe('AgentTracker State Machine', () => {
  it('initializes panels with idle state and 0 unread', () => {
    const tracker = new AgentTracker()
    expect(tracker.getStatus('p1')).toBe('idle')
    expect(tracker.getUnreadCount()).toBe(0)
  })

  it('transitions through running -> waiting -> running -> done', () => {
    const tracker = new AgentTracker()
    const statusChanges: string[] = []

    tracker.on('status-change', (e) => {
      statusChanges.push(`${e.panelId}:${e.status}`)
    })

    // Active panel is p2
    tracker.setActivePanel('p2')

    // Launch agent on p1
    tracker.setStatus('p1', 'running', 'Agent started')
    expect(tracker.getStatus('p1')).toBe('running')
    expect(tracker.isUnread('p1')).toBe(false)

    // Agent needs input -> waiting (since p1 is not active, becomes unread)
    tracker.setStatus('p1', 'waiting', 'Needs confirmation')
    expect(tracker.getStatus('p1')).toBe('waiting')
    expect(tracker.isUnread('p1')).toBe(true)
    expect(tracker.getUnreadCount()).toBe(1)

    // User provides input to p1 -> returns to running and clears unread
    tracker.onUserInput('p1')
    expect(tracker.getStatus('p1')).toBe('running')
    expect(tracker.isUnread('p1')).toBe(false)
    expect(tracker.getUnreadCount()).toBe(0)

    // Agent completes -> done (unread since still not active panel)
    tracker.setStatus('p1', 'done', 'Task complete')
    expect(tracker.getStatus('p1')).toBe('done')
    expect(tracker.isUnread('p1')).toBe(true)

    // User focuses panel p1 -> unread cleared
    tracker.setActivePanel('p1')
    expect(tracker.isUnread('p1')).toBe(false)
    expect(tracker.getUnreadCount()).toBe(0)

    expect(statusChanges).toEqual([
      'p1:running',
      'p1:waiting',
      'p1:running',
      'p1:done'
    ])
  })

  it('triggers heuristic prompt detection on matching output', () => {
    const tracker = new AgentTracker()
    tracker.setStatus('p1', 'running')

    tracker.onPtyOutput('p1', 'Do you want to proceed? [y/N] ')
    expect(tracker.getStatus('p1')).toBe('waiting')
  })
})
