import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { terminalRegistry } from './terminal/terminals'
import { TERMINAL_FONT_SIZE } from './terminal/xterm-handle'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles/index.css'

// How long the first render waits for the bundled terminal font.
const FONT_LOAD_TIMEOUT_MS = 1000

if (window.electronAPI) {
  window.electronAPI.onFlushScrollback(() => terminalRegistry.flushScrollback())
  terminalRegistry.startAutosave()

  // Read-only inspection hook for the end-to-end tests: dev and test builds
  // started with MYTERM_DEBUG=1 only. Production builds do not contain it.
  if (__MYTERM_TEST_HOOKS__ && window.electronAPI.isDebug) {
    Object.assign(window, {
      __myterm: {
        sessions: () => terminalRegistry.debugSessions(),
        terminal: (id: string) => terminalRegistry.debugTerminal(id),
        webglCount: () => terminalRegistry.webglCount
      }
    })
  }
}

// xterm measures its cells when a terminal opens. Rendering waits for the
// bundled font (regular and bold), or every cell would be sized for a fallback
// font. A font that fails to load only costs the timeout.
function loadTerminalFont(): Promise<unknown> {
  const faces = ['400', '700'].map((weight) =>
    document.fonts.load(`${weight} ${TERMINAL_FONT_SIZE}px "JetBrains Mono"`).catch(() => [])
  )
  const timeout = new Promise((resolve) => setTimeout(resolve, FONT_LOAD_TIMEOUT_MS))
  return Promise.race([Promise.all(faces), timeout])
}

const rootElement = document.getElementById('root')
if (rootElement) {
  void loadTerminalFont().then(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  })
}
