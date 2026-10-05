import { describe, it, expect } from 'vitest'
import { DARK_TERMINAL_THEME, LIGHT_TERMINAL_THEME } from '../src/renderer/src/terminal/terminal-themes'

// Convert hex (#rrggbb) to relative luminance according to WCAG 2.1
function hexToLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255

  const srgb = [r, g, b].map((val) => {
    return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = hexToLuminance(hex1)
  const l2 = hexToLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Terminal Themes Contrast (WCAG 2.1 AA)', () => {
  describe('Light Terminal Theme', () => {
    const bg = LIGHT_TERMINAL_THEME.background as string
    expect(bg).toBe('#fbfcfd')

    it('foreground meets 4.5:1 on background', () => {
      const fg = LIGHT_TERMINAL_THEME.foreground as string
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })

    it('all standard 8 ANSI colors meet 4.5:1 on light background', () => {
      const ansi8 = [
        ['black', LIGHT_TERMINAL_THEME.black],
        ['red', LIGHT_TERMINAL_THEME.red],
        ['green', LIGHT_TERMINAL_THEME.green],
        ['yellow', LIGHT_TERMINAL_THEME.yellow],
        ['blue', LIGHT_TERMINAL_THEME.blue],
        ['magenta', LIGHT_TERMINAL_THEME.magenta],
        ['cyan', LIGHT_TERMINAL_THEME.cyan],
        ['white', LIGHT_TERMINAL_THEME.white]
      ] as const

      for (const [name, color] of ansi8) {
        const ratio = contrastRatio(color as string, bg)
        expect(ratio, `ANSI color ${name} (${color}) contrast ratio ${ratio.toFixed(2)} should be >= 4.5`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('all bright 8 ANSI colors meet 4.5:1 on light background', () => {
      const brightAnsi8 = [
        ['brightBlack', LIGHT_TERMINAL_THEME.brightBlack],
        ['brightRed', LIGHT_TERMINAL_THEME.brightRed],
        ['brightGreen', LIGHT_TERMINAL_THEME.brightGreen],
        ['brightYellow', LIGHT_TERMINAL_THEME.brightYellow],
        ['brightBlue', LIGHT_TERMINAL_THEME.brightBlue],
        ['brightMagenta', LIGHT_TERMINAL_THEME.brightMagenta],
        ['brightCyan', LIGHT_TERMINAL_THEME.brightCyan],
        ['brightWhite', LIGHT_TERMINAL_THEME.brightWhite]
      ] as const

      for (const [name, color] of brightAnsi8) {
        const ratio = contrastRatio(color as string, bg)
        expect(ratio, `ANSI bright color ${name} (${color}) contrast ratio ${ratio.toFixed(2)} should be >= 4.5`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('yellow, white, and gray are clearly readable on light background', () => {
      // Required by spec: "especially yellow, white and gray"
      expect(contrastRatio(LIGHT_TERMINAL_THEME.yellow as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(LIGHT_TERMINAL_THEME.brightYellow as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(LIGHT_TERMINAL_THEME.white as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(LIGHT_TERMINAL_THEME.brightBlack as string, bg)).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('Dark Terminal Theme', () => {
    const bg = DARK_TERMINAL_THEME.background as string
    expect(bg).toBe('#0c0f13')

    it('foreground meets 4.5:1 on dark background', () => {
      const fg = DARK_TERMINAL_THEME.foreground as string
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })

    it('ANSI colors meet contrast on dark background', () => {
      expect(contrastRatio(DARK_TERMINAL_THEME.yellow as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(DARK_TERMINAL_THEME.green as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(DARK_TERMINAL_THEME.cyan as string, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(DARK_TERMINAL_THEME.white as string, bg)).toBeGreaterThanOrEqual(4.5)
    })
  })
})
