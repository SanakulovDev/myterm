/**
 * Automatic panel naming from prompt text (Section 3.3).
 *
 * Rules:
 * - Local only, no network calls.
 * - Strips code blocks, markdown, file paths, URLs.
 * - Strips sensitive secrets (API keys, tokens, Bearer headers, long random hashes).
 * - Takes the first 4-6 meaningful words, formatted in Title Case.
 * - Length capped at 40 characters without breaking mid-word.
 * - Fallback to agent name (e.g., 'Claude', 'Codex', 'Shell').
 * - Supports emojis, Unicode/non-English scripts, multi-line input.
 */

const CODE_BLOCK_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`]*`/g
const URL_RE = /https?:\/\/\S+|ftp:\/\/\S+/gi
const PATH_RE = /(?:^|\s)(?:~|\.{1,2})?\/[\w\-./\\]+/g
const BEARER_RE = /Bearer\s+[\w\-._~+/]+=*/gi
const SECRET_KV_RE =
  /\b(?:api[_-]?key|secret|token|password|passwd|auth|access_token|client_secret)\s*[:=]\s*\S+/gi
const LONG_RANDOM_HASH_RE = /\b[A-Za-z0-9_-]{24,}\b|\b[A-Fa-f0-9]{20,}\b/g
const MARKDOWN_CHARS_RE = /[*_#~>\[\]()!]/g

export function generatePanelName(prompt: string, fallback = 'Shell'): string {
  if (!prompt || typeof prompt !== 'string') return fallback

  let cleaned = prompt
    // Strip code blocks and inline code
    .replace(CODE_BLOCK_RE, ' ')
    .replace(INLINE_CODE_RE, ' ')
    // Strip URLs
    .replace(URL_RE, ' ')
    // Strip secrets: bearer tokens, key=value pairs, long hex/base64 strings
    .replace(BEARER_RE, ' ')
    .replace(SECRET_KV_RE, ' ')
    .replace(LONG_RANDOM_HASH_RE, ' ')
    // Strip file paths
    .replace(PATH_RE, ' ')
    // Strip markdown formatting symbols
    .replace(MARKDOWN_CHARS_RE, ' ')

  // Normalize whitespace and newlines
  cleaned = cleaned.replace(/[\r\n\t]+/g, ' ').trim()
  if (!cleaned) return fallback

  // Extract meaningful words (letters/numbers across all Unicode scripts or emojis)
  const wordTokens = cleaned.match(/[\p{L}\p{N}]+|\p{Extended_Pictographic}/gu)
  if (!wordTokens || wordTokens.length === 0) return fallback

  // Take first 4-6 meaningful words
  const selected = wordTokens.slice(0, 6)

  // Title Case each word (capitalize first char, keep rest)
  const titleCased = selected.map((word) => {
    // Preserve emojis
    if (/^\p{Extended_Pictographic}$/u.test(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })

  // Accumulate words within the 40 character limit
  let result = ''
  for (const w of titleCased) {
    const candidate = result ? `${result} ${w}` : w
    if (candidate.length > 40) {
      if (!result) {
        result = candidate.slice(0, 40)
      }
      break
    }
    result = candidate
  }

  return result || fallback
}
