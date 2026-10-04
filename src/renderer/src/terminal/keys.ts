/** The fields of a KeyboardEvent the key map reads. */
export type KeyInput = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'
>

/**
 * Keys xterm.js sends differently from macOS terminals (Ghostty, cmux,
 * Terminal.app), as the bytes those terminals send. Null: xterm.js handles
 * the key itself.
 *
 * - Shift+Enter inserts a newline in Claude Code and other agent prompts.
 *   Native terminals report it through the kitty keyboard protocol, which
 *   xterm.js lacks; ESC CR (Alt+Enter) is what Claude Code's /terminal-setup
 *   binds Shift+Enter to in terminals without it.
 * - Option+Left/Right jump a word (readline's ESC b / ESC f) instead of
 *   xterm's CSI 1;3 D/C, which zsh does not bind by default.
 * - Cmd+Left/Right go to the line start/end (Ctrl+A / Ctrl+E), and
 *   Cmd+Backspace deletes to the line start (Ctrl+U).
 */
export function macKeySequence(ev: KeyInput): string | null {
  if (ev.isComposing || ev.ctrlKey) return null
  const { key, shiftKey, altKey, metaKey } = ev
  if (key === 'Enter' && shiftKey && !altKey && !metaKey) return '\x1b\r'
  if (shiftKey) return null
  if (altKey && !metaKey) {
    if (key === 'ArrowLeft') return '\x1bb'
    if (key === 'ArrowRight') return '\x1bf'
  }
  if (metaKey && !altKey) {
    if (key === 'ArrowLeft') return '\x01'
    if (key === 'ArrowRight') return '\x05'
    if (key === 'Backspace') return '\x15'
  }
  return null
}
