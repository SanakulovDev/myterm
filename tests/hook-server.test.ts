import { describe, it, expect, afterAll } from 'vitest'
import { HookServer } from '../src/main/hook-server'
import * as http from 'http'

describe('HookServer', () => {
  const hookServer = new HookServer()

  afterAll(() => {
    hookServer.stop()
  })

  it('starts Unix socket server and accepts event payloads', async () => {
    await hookServer.start()
    const sockPath = hookServer.getSocketPath()
    expect(sockPath).toBeDefined()

    const receivedEvents: Array<{ panelId: string; status: string; detail?: string }> = []
    hookServer.onEvent((panelId, status, detail) => {
      receivedEvents.push({ panelId, status, detail })
    })

    // Send HTTP POST over unix socket
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: sockPath,
          path: '/event',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            const parsed = JSON.parse(data)
            expect(parsed.ok).toBe(true)
            expect(parsed.status).toBe('waiting')
            resolve()
          })
        }
      )

      req.on('error', reject)
      req.write(
        JSON.stringify({
          panelId: 'panel-test-1',
          event: 'waiting_for_user_input',
          detail: 'Needs API key permission'
        })
      )
      req.end()
    })

    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0]).toEqual({
      panelId: 'panel-test-1',
      status: 'waiting',
      detail: 'Needs API key permission'
    })
  })
})
