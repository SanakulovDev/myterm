import { Terminal, ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ElectronAPI } from '../../../shared/types'
import { TerminalHandle } from './terminal-registry'
import { macKeySequence } from './keys'
import { dropInsertText } from './drop'
import { DARK_TERMINAL_THEME } from './terminal-themes'

// The font is bundled (main.tsx loads it before any terminal opens), so
// every Mac renders the same cells. Glyphs it lacks fall back in this order.
export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'SF Mono', Menlo, Monaco, monospace"
export const TERMINAL_FONT_SIZE = 13

const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  cursorStyle: 'bar',
  fontSize: TERMINAL_FONT_SIZE,
  fontFamily: TERMINAL_FONT_FAMILY,
  // Specified in Design Tokens (Section 1): terminal 13px, line-height 1.65.
  lineHeight: 1.65,
  scrollback: 5000,
  // Option sends ESC-prefixed keys (Option+Enter, Option+B, ...) like a
  // terminal's "Option as Meta" setting; Option+click still selects text in
  // programs that capture the mouse.
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  // Needed by the Unicode 11 width tables (terminal.unicode).
  allowProposedApi: true,
  theme: DARK_TERMINAL_THEME,
  allowTransparency: true
}

/** What a terminal needs from the app besides its PTY. */
export type XtermHost = Pick<ElectronAPI, 'openExternal' | 'pathForFile'>

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

export function createXtermHandle(app: XtermHost): TerminalHandle {
  const host = document.createElement('div')
  host.className = 'terminal-host'

  // Links open with Cmd+click, as in other macOS terminals; a plain click
  // stays a click (selection, or the mouse in a full-screen program). Main
  // opens http(s) links only.
  const activateLink = (event: MouseEvent, uri: string): void => {
    if (event.metaKey) app.openExternal(uri)
  }

  const term = new Terminal({ ...TERMINAL_OPTIONS, linkHandler: { activate: activateLink } })
  const fitAddon = new FitAddon()
  const searchAddon = new SearchAddon()
  const serializeAddon = new SerializeAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(searchAddon)
  term.loadAddon(serializeAddon)
  term.loadAddon(new WebLinksAddon(activateLink))
  // Emoji and newer symbols are two cells wide, as agents' TUIs assume.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'

  term.attachCustomKeyEventHandler((event) => {
    const sequence = macKeySequence(event)
    if (sequence === null) return true
    if (event.type === 'keydown') {
      event.preventDefault()
      term.input(sequence)
    }
    return false
  })

  // Dropped files type their escaped paths at the cursor, as a paste, so
  // agents that accept pasted image paths attach them.
  host.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  })
  host.addEventListener('drop', (event) => {
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return
    event.preventDefault()
    const text = dropInsertText(Array.from(files, (file) => app.pathForFile(file)))
    if (!text) return
    term.paste(text)
    term.focus()
  })

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
    paste: (text) => term.paste(text),

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
        fontFamily: term.options.fontFamily ?? '',
        fontSize: term.options.fontSize ?? 0,
        unicodeVersion: term.unicode.activeVersion,
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
