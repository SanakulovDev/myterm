import { describe, it, expect } from 'vitest'
import { generatePanelName } from '../src/shared/autoname'

describe('generatePanelName', () => {
  it('falls back when given empty or whitespace prompt', () => {
    expect(generatePanelName('')).toBe('Shell')
    expect(generatePanelName('   \n\t  ', 'Claude')).toBe('Claude')
  })

  it('generates clean Title Case names from standard prompts', () => {
    expect(generatePanelName('add a health check endpoint to backend')).toBe('Add A Health Check Endpoint To')
    expect(generatePanelName('refactor auth middleware')).toBe('Refactor Auth Middleware')
  })

  it('strips code blocks, backticks, and markdown formatting', () => {
    const prompt = 'Fix the bug in ```ts\nconst x = 1\n``` and update `index.ts` **immediately**!'
    expect(generatePanelName(prompt)).toBe('Fix The Bug In And Update')
  })

  it('strips URLs and file paths', () => {
    const prompt = 'Inspect https://example.com/api/v1 and check /var/log/myterm.log for crashes'
    expect(generatePanelName(prompt)).toBe('Inspect And Check For Crashes')
  })

  it('strips secrets, bearer tokens, api keys, and long random hashes', () => {
    const prompt =
      'Connect with token=ghp_ABC1234567890abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI to sync users'
    expect(generatePanelName(prompt)).toBe('Connect With And To Sync Users')
  })

  it('supports non-English scripts (Uzbek, Cyrillic, Chinese, etc.)', () => {
    expect(generatePanelName('foydalanuvchi tizimiga kirish')).toBe('Foydalanuvchi Tizimiga Kirish')
    expect(generatePanelName('исправление ошибок в базе данных')).toBe('Исправление Ошибок В Базе Данных')
    expect(generatePanelName('优化用户登录界面')).toBe('优化用户登录界面')
  })

  it('supports and preserves emojis cleanly', () => {
    expect(generatePanelName('🚀 deploy new release to staging')).toBe('🚀 Deploy New Release To Staging')
  })

  it('handles multi-line and very long inputs under 40 characters limit', () => {
    const multiLine = `First line of prompt
    second line with extra words and details that are very lengthy
    third line`
    const name = generatePanelName(multiLine)
    expect(name.length).toBeLessThanOrEqual(40)
    expect(name).toBe('First Line Of Prompt Second Line')
  })
})
