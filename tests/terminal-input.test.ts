import { describe, it, expect } from 'vitest'
import { macKeySequence, KeyInput } from '../src/renderer/src/terminal/keys'
import { dropInsertText, shellEscapePath } from '../src/renderer/src/terminal/drop'

// Keys and drops as a macOS terminal (Ghostty, cmux) sends them.

function key(k: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...mods }
}

describe('macKeySequence', () => {
  it('sends ESC CR for Shift+Enter (a newline in agent prompts)', () => {
    expect(macKeySequence(key('Enter', { shiftKey: true }))).toBe('\x1b\r')
  })

  it('leaves plain Enter and Option+Enter to xterm', () => {
    expect(macKeySequence(key('Enter'))).toBeNull()
    expect(macKeySequence(key('Enter', { altKey: true }))).toBeNull()
    expect(macKeySequence(key('Enter', { shiftKey: true, metaKey: true }))).toBeNull()
  })

  it('jumps words with Option+Left/Right', () => {
    expect(macKeySequence(key('ArrowLeft', { altKey: true }))).toBe('\x1bb')
    expect(macKeySequence(key('ArrowRight', { altKey: true }))).toBe('\x1bf')
  })

  it('goes to the line start/end with Cmd+Left/Right and deletes the line with Cmd+Backspace', () => {
    expect(macKeySequence(key('ArrowLeft', { metaKey: true }))).toBe('\x01')
    expect(macKeySequence(key('ArrowRight', { metaKey: true }))).toBe('\x05')
    expect(macKeySequence(key('Backspace', { metaKey: true }))).toBe('\x15')
  })

  it('leaves selection, Ctrl and IME composition alone', () => {
    expect(macKeySequence(key('ArrowLeft', { altKey: true, shiftKey: true }))).toBeNull()
    expect(macKeySequence(key('ArrowLeft', { metaKey: true, shiftKey: true }))).toBeNull()
    expect(macKeySequence(key('ArrowLeft', { ctrlKey: true }))).toBeNull()
    expect(macKeySequence(key('Enter', { shiftKey: true, isComposing: true }))).toBeNull()
    expect(macKeySequence(key('ArrowLeft'))).toBeNull()
    expect(macKeySequence(key('a', { altKey: true }))).toBeNull()
  })
})

describe('shellEscapePath', () => {
  it('leaves ordinary paths alone', () => {
    expect(shellEscapePath('/Users/me/project/src/app.ts')).toBe('/Users/me/project/src/app.ts')
    expect(shellEscapePath('/tmp/a-b_c.d+e,f:g@h%i')).toBe('/tmp/a-b_c.d+e,f:g@h%i')
  })

  it('backslash-escapes spaces and shell metacharacters', () => {
    expect(shellEscapePath('/Users/me/My File.png')).toBe('/Users/me/My\\ File.png')
    expect(shellEscapePath(`/x/it's "q" $HOME \`id\` !(a)&b;c|d*e?[f]{g}<h>~i#j=k\\l`)).toBe(
      `/x/it\\'s\\ \\"q\\"\\ \\$HOME\\ \\\`id\\\`\\ \\!\\(a\\)\\&b\\;c\\|d\\*e\\?\\[f\\]\\{g\\}\\<h\\>\\~i\\#j\\=k\\\\l`
    )
  })

  it('keeps non-ASCII characters as they are', () => {
    // macOS screenshot names contain a narrow no-break space (U+202F).
    expect(shellEscapePath('/Users/me/Ish stoli/rasm 1 😀.png')).toBe(
      '/Users/me/Ish\\ stoli/rasm 1\\ 😀.png'
    )
  })

  it('single-quotes a path with a control character', () => {
    expect(shellEscapePath("/tmp/a\nb's")).toBe("'/tmp/a\nb'\\''s'")
  })
})

describe('dropInsertText', () => {
  it('joins escaped paths with spaces and ends with a space', () => {
    expect(dropInsertText(['/a b', '/c'])).toBe('/a\\ b /c ')
  })

  it('types nothing for files without a path', () => {
    expect(dropInsertText([])).toBe('')
    expect(dropInsertText(['', ''])).toBe('')
    expect(dropInsertText(['', '/c'])).toBe('/c ')
  })
})
