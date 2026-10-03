import { TerminalRegistry } from './terminal-registry'
import { WebglBudget } from './webgl-budget'
import { createXtermHandle } from './xterm-handle'

/** The app's single terminal registry (one session per open panel). */
export const terminalRegistry = new TerminalRegistry({
  api: window.electronAPI,
  createTerminal: createXtermHandle,
  budget: new WebglBudget()
})
