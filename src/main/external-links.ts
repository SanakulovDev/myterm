// Links clicked in a terminal, or opened by the page, go to the default
// browser. Only web links: file:, javascript:, data: and custom app schemes
// (which can launch other apps with arguments) never leave the app.
const MAX_URL_LENGTH = 8192

export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
