import { Terminal, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { TerminalHandle } from './terminal-registry'

const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  cursorStyle: 'bar',
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  lineHeight: 1.25,
  scrollback: 5000,
  theme: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    selectionBackground: 'rgba(88, 166, 255, 0.3)',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc'
  },
  allowTransparency: true
}

// Host elements of panels that are not mounted (other workspaces) wait here.
// display:none makes xterm's IntersectionObserver pause rendering; writes are
// still parsed into the buffer.
let parkingLot: HTMLDivElement | null = null

function getParkingLot(): HTMLDivElement {
  if (!parkingLot) {
    parkingLot = document.createElement('div')
    parkingLot.className = 'terminal-parking-lot'
    parkingLot.style.display = 'none'
    parkingLot.setAttribute('aria-hidden', 'true')
    document.body.appendChild(parkingLot)
  }
  return parkingLot
}

// Disposing the WebGL addon drops the renderer but leaves its GL context alive
// until garbage collection, so repeated hide/show would pile up contexts and
// hit Chromium's limit. Lose the context explicitly instead.
function loseContexts(canvases: HTMLCanvasElement[]): void {
  for (const canvas of canvases) {
    const gl = canvas.getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

export function createXtermHandle(): TerminalHandle {
  const host = document.createElement('div')
  host.className = 'terminal-host'

  const term = new Terminal(TERMINAL_OPTIONS)
  const fitAddon = new FitAddon()
  const searchAddon = new SearchAddon()
  const serializeAddon = new SerializeAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(searchAddon)
  term.loadAddon(serializeAddon)

  let opened = false

  return {
    get cols() {
      return term.cols
    },
    get rows() {
      return term.rows
    },

    mountIn(container) {
      if (host.parentElement !== container) container.appendChild(host)
      if (!opened) {
        term.open(host)
        opened = true
      }
    },

    park() {
      getParkingLot().appendChild(host)
    },

    write: (data) => term.write(data),

    onData(listener) {
      term.onData(listener)
    },

    fit() {
      if (!opened) return false
      const dims = fitAddon.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false
      if (dims.cols < 2 || dims.rows < 1) return false
      fitAddon.fit()
      return true
    },

    refresh: () => term.refresh(0, term.rows - 1),

    focus: () => term.focus(),

    serialize: () => serializeAddon.serialize(),

    findNext: (text) => searchAddon.findNext(text),

    findPrevious: (text) => searchAddon.findPrevious(text),

    attachWebgl(onContextLoss) {
      const before = new Set(host.querySelectorAll('canvas'))
      let lost = false
      let addon: WebglAddon
      try {
        addon = new WebglAddon()
        addon.onContextLoss(() => {
          lost = true
          onContextLoss()
        })
        term.loadAddon(addon)
      } catch {
        console.warn('WebGL renderer unavailable; using the DOM renderer')
        return null
      }
      const canvases = Array.from(host.querySelectorAll('canvas')).filter((c) => !before.has(c))
      return {
        dispose: () => {
          addon.dispose()
          if (!lost) loseContexts(canvases)
        }
      }
    },

    debugInfo() {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
      }
      return {
        cols: term.cols,
        rows: term.rows,
        cursorX: buffer.cursorX,
        cursorY: buffer.cursorY,
        bufferLength: buffer.length,
        text: lines.join('\n')
      }
    },

    dispose() {
      term.dispose()
      host.remove()
    }
  }
}
