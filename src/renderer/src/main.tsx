import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { terminalRegistry } from './terminal/terminals'
import './styles/index.css'

if (window.electronAPI) {
  window.electronAPI.onFlushScrollback(() => terminalRegistry.flushScrollback())

  // Read-only inspection hook for the end-to-end tests (MYTERM_DEBUG=1 only).
  if (window.electronAPI.isDebug) {
    Object.assign(window, {
      __myterm: {
        sessions: () => terminalRegistry.debugSessions(),
        terminal: (id: string) => terminalRegistry.debugTerminal(id),
        webglCount: () => terminalRegistry.webglCount
      }
    })
  }
}

const rootElement = document.getElementById('root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
