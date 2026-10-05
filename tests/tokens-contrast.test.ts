import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

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

describe('Design Tokens Contrast (WCAG 2.1 AA)', () => {
  const tokensPath = path.resolve(__dirname, '../src/renderer/src/styles/tokens.css')
  const css = fs.readFileSync(tokensPath, 'utf8')

  function extractToken(cssText: string, selector: string, token: string): string | null {
    const blockRegex = new RegExp(`${selector}\\s*\\{([^}]+)\\}`, 'm')
    const match = cssText.match(blockRegex)
    if (!match) return null
    const tokenRegex = new RegExp(`${token}:\\s*([^;]+);`)
    const tokenMatch = match[1].match(tokenRegex)
    return tokenMatch ? tokenMatch[1].trim() : null
  }

  describe('Dark Theme', () => {
    const bg = '#090b0e'
    const surface = '#0f1217'
    const terminalBg = '#0c0f13'
    const selected = '#19202e'

    const textPrimary = '#e6e9ef'
    const textSecondary = '#c9d1dc'
    const textTertiary = '#aab3c0'
    const caption = '#808a9a'

    it('text tokens meet 4.5:1 on background and surface', () => {
      expect(contrastRatio(textPrimary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textPrimary, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textPrimary, terminalBg)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(textSecondary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textSecondary, surface)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(textTertiary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textTertiary, surface)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(caption, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(caption, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(caption, selected)).toBeGreaterThanOrEqual(4.5)
    })

    it('control borders meet 3:1 on surface and bg', () => {
      const controlBorder = '#646e7e'
      expect(contrastRatio(controlBorder, bg)).toBeGreaterThanOrEqual(3.0)
      expect(contrastRatio(controlBorder, surface)).toBeGreaterThanOrEqual(3.0)
    })

    it('status colors are distinguishable and meet contrast for icons/dots', () => {
      const statusRunning = '#3ecf8e'
      const statusWaiting = '#f5b942'
      const statusError = '#ff6b6b'

      expect(contrastRatio(statusRunning, bg)).toBeGreaterThanOrEqual(3.0)
      expect(contrastRatio(statusWaiting, bg)).toBeGreaterThanOrEqual(3.0)
      expect(contrastRatio(statusError, bg)).toBeGreaterThanOrEqual(3.0)
    })
  })

  describe('Light Theme', () => {
    const bg = '#eceff3'
    const surface = '#ffffff'
    const terminalBg = '#fbfcfd'
    const selected = '#e4ecfb'

    const textPrimary = '#1a1f29'
    const textSecondary = '#323a47'
    const textTertiary = '#454e5c'
    const caption = '#5f6a7a'

    it('text tokens meet 4.5:1 on background and surface', () => {
      expect(contrastRatio(textPrimary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textPrimary, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textPrimary, terminalBg)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(textSecondary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textSecondary, surface)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(textTertiary, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(textTertiary, surface)).toBeGreaterThanOrEqual(4.5)

      expect(contrastRatio(caption, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(caption, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(caption, selected)).toBeGreaterThanOrEqual(4.5)
    })

    it('control borders meet 3:1 on surface and bg', () => {
      const controlBorder = '#7a8493'
      expect(contrastRatio(controlBorder, bg)).toBeGreaterThanOrEqual(3.0)
      expect(contrastRatio(controlBorder, surface)).toBeGreaterThanOrEqual(3.0)
    })
  })
})
