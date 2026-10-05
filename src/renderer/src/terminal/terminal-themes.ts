import type { ITheme } from '@xterm/xterm'

// One xterm theme per app theme. The background matches the --terminal-bg
// token (styles/tokens.css) so the area below the last row blends in.
export const DARK_TERMINAL_THEME: ITheme = {
  background: '#0c0f13',
  foreground: '#c9d1dc',
  cursor: '#6ea8ff',
  cursorAccent: '#0c0f13',
  selectionBackground: 'rgba(110, 168, 255, 0.3)',
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
}

export const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#fbfcfd',
  foreground: '#1a1f29',
  cursor: '#2f6fe0',
  cursorAccent: '#fbfcfd',
  selectionBackground: 'rgba(47, 111, 224, 0.2)',
  selectionInactiveBackground: 'rgba(47, 111, 224, 0.12)',
  black: '#1a1f29',
  red: '#cf222e',
  green: '#116329',
  yellow: '#855b00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#57606a',
  brightBlack: '#4c5561',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#7a4e00',
  brightBlue: '#1a68d1',
  brightMagenta: '#703bbb',
  brightCyan: '#136b72',
  brightWhite: '#24292f'
}

