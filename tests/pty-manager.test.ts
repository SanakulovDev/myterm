import { describe, it, expect, afterAll } from 'vitest'
import { PtyManager } from '../src/main/pty-manager'

describe('PtyManager', () => {
  const ptyManager = new PtyManager()

  afterAll(() => {
    ptyManager.killAll()
  })

  it('spawns a PTY, receives data, and handles exit', async () => {
    let output = ''
    let exitCodeResult: number | null = null

    const exitPromise = new Promise<void>((resolve) => {
      ptyManager.spawn(
        {
          id: 'test-panel-1',
          cwd: process.cwd(),
          shell: '/bin/bash',
          cols: 80,
          rows: 24
        },
        (chunk) => {
          output += chunk
        },
        (code) => {
          exitCodeResult = code
          resolve()
        }
      )
    })

    // Write a test command
    ptyManager.write('test-panel-1', 'echo "MYTERM_TEST_OUTPUT"\nexit 0\n')

    await exitPromise

    expect(output).toContain('MYTERM_TEST_OUTPUT')
    expect(exitCodeResult).toBe(0)
    expect(ptyManager.hasPty('test-panel-1')).toBe(false)
  })

  it('does not trigger onExit when killed intentionally', async () => {
    let exitTriggered = false

    ptyManager.spawn(
      {
        id: 'test-kill-panel',
        cwd: process.cwd(),
        shell: '/bin/bash',
        cols: 80,
        rows: 24
      },
      () => {},
      () => {
        exitTriggered = true
      }
    )

    // Intentionally kill
    ptyManager.kill('test-kill-panel')

    // Wait a brief moment for process termination
    await new Promise((r) => setTimeout(r, 100))

    expect(exitTriggered).toBe(false)
    expect(ptyManager.hasPty('test-kill-panel')).toBe(false)
  })
})
