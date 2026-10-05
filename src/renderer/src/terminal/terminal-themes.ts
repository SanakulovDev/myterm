import type { ITheme } from '@xterm/xterm'

// One xterm theme per app theme. The background matches the --terminal-bg
// token (styles/tokens.css) so the area below the last row blends in.
// The light theme arrives with the theme switch (Part C4).
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
