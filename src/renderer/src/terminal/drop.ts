// ASCII characters that no shell (sh, bash, zsh, fish) treats specially
// inside a word. Every other ASCII character is escaped with a backslash, as
// Terminal.app, iTerm2 and Ghostty do, so agents that recognize a dropped
// image path (Claude Code) see the form they expect. Non-ASCII characters
// are never special and stay as they are.
const PLAIN_ASCII = /[A-Za-z0-9_\-./+,:@%]/
// Control characters (a newline in a file name) cannot be backslash-escaped:
// backslash-newline is a line continuation. Such a path is single-quoted.
const CONTROL = /[\x00-\x1f\x7f]/

export function shellEscapePath(filePath: string): string {
  if (CONTROL.test(filePath)) return `'${filePath.replace(/'/g, `'\\''`)}'`
  let escaped = ''
  for (const ch of filePath) {
    escaped += (ch.codePointAt(0) ?? 0) > 0x7f || PLAIN_ASCII.test(ch) ? ch : `\\${ch}`
  }
  return escaped
}

/**
 * What dropping these files on a terminal types: each path escaped, separated
 * by spaces, with a trailing space so the next word can follow. Empty paths
 * (files with no location on disk) are skipped.
 */
export function dropInsertText(paths: string[]): string {
  const words = paths.filter((p) => p !== '').map(shellEscapePath)
  return words.length === 0 ? '' : `${words.join(' ')} `
}
