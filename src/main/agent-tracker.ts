import { EventEmitter } from 'events'
import { PanelStatus } from '../shared/types'

export interface AgentStatusEvent {
  panelId: string
  status: PanelStatus
  detail?: string
  isHeuristic?: boolean
}

export class AgentTracker extends EventEmitter {
  private panelStates: Map<string, PanelStatus> = new Map()
  private unreadPanels: Set<string> = new Set()
  private heuristicTimers: Map<string, NodeJS.Timeout> = new Map()
  private activePanelId: string | null = null

  constructor() {
    super()
  }

  public setActivePanel(panelId: string | null): void {
    this.activePanelId = panelId
    if (panelId && this.unreadPanels.has(panelId)) {
      this.unreadPanels.delete(panelId)
      this.emit('unread-change', this.getUnreadCount())
    }
  }

  public getStatus(panelId: string): PanelStatus {
    return this.panelStates.get(panelId) || 'idle'
  }

  public getUnreadCount(): number {
    return this.unreadPanels.size
  }

  public isUnread(panelId: string): boolean {
    return this.unreadPanels.has(panelId)
  }

  public markRead(panelId: string): void {
    if (this.unreadPanels.delete(panelId)) {
      this.emit('unread-change', this.getUnreadCount())
    }
  }

  public setStatus(
    panelId: string,
    status: PanelStatus,
    detail?: string,
    isHeuristic: boolean = false
  ): void {
    const currentStatus = this.panelStates.get(panelId)
    if (currentStatus === status && !detail) {
      return
    }

    this.panelStates.set(panelId, status)

    // Clear any pending heuristic silence timer
    const existingTimer = this.heuristicTimers.get(panelId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.heuristicTimers.delete(panelId)
    }

    // Unread logic: if transitioned to waiting or done, and not the active panel
    if ((status === 'waiting' || status === 'done') && panelId !== this.activePanelId) {
      this.unreadPanels.add(panelId)
      this.emit('unread-change', this.getUnreadCount())
    }

    const event: AgentStatusEvent = {
      panelId,
      status,
      detail,
      isHeuristic
    }

    this.emit('status-change', event)
  }

  /**
   * Handle user keyboard/stdin input to a panel.
   * If agent was waiting, user input moves it back to running.
   */
  public onUserInput(panelId: string): void {
    const status = this.panelStates.get(panelId)
    if (status === 'waiting') {
      this.setStatus(panelId, 'running', 'User provided input')
    }
    if (this.unreadPanels.has(panelId)) {
      this.markRead(panelId)
    }
  }

  /**
   * Process raw output stream for heuristics fallback when hooks are not active.
   */
  public onPtyOutput(panelId: string, data: string, hasHooks: boolean = false): void {
    if (hasHooks) {
      // If agent has active hook integration, avoid heuristic overrides
      return
    }

    const currentStatus = this.panelStates.get(panelId)
    if (currentStatus !== 'running') {
      return
    }

    // Clear existing timer
    const existing = this.heuristicTimers.get(panelId)
    if (existing) {
      clearTimeout(existing)
    }

    // Check for common prompt / waiting patterns (labeled as heuristic)
    const promptPatterns = [
      /\?\s*\[y\/n\]/i,
      /\(y\/n\)/i,
      /press enter to continue/i,
      /allow .+ to (read|write|execute)/i,
      /do you want to proceed/i,
      /select an option/i,
      /enter a choice/i
    ]

    const isPrompt = promptPatterns.some((pattern) => pattern.test(data))
    if (isPrompt) {
      this.setStatus(panelId, 'waiting', 'Heuristic: input prompt detected', true)
      return
    }

    // Set a quiet timer: if no output for 6 seconds while running, check heuristic
    const timer = setTimeout(() => {
      this.heuristicTimers.delete(panelId)
      const st = this.panelStates.get(panelId)
      if (st === 'running') {
        this.setStatus(panelId, 'done', 'Heuristic: quiet period after activity', true)
      }
    }, 6000)

    this.heuristicTimers.set(panelId, timer)
  }

  public removePanel(panelId: string): void {
    this.panelStates.delete(panelId)
    this.unreadPanels.delete(panelId)
    const timer = this.heuristicTimers.get(panelId)
    if (timer) {
      clearTimeout(timer)
      this.heuristicTimers.delete(panelId)
    }
    this.emit('unread-change', this.getUnreadCount())
  }
}
