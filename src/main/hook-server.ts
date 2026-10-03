import * as http from 'http'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PanelStatus } from '../shared/types'

export interface HookEventPayload {
  panelId: string
  event: 'waiting' | 'done' | 'running' | 'idle' | string
  detail?: string
}

export class HookServer {
  private server: http.Server | null = null
  private socketPath: string
  private port: number = 0
  private onEventHandler?: (panelId: string, status: PanelStatus, detail?: string) => void

  constructor() {
    this.socketPath = path.join(os.tmpdir(), `myterm-${process.pid}.sock`)
  }

  public getSocketPath(): string {
    return this.socketPath
  }

  public getPort(): number {
    return this.port
  }

  public onEvent(callback: (panelId: string, status: PanelStatus, detail?: string) => void): void {
    this.onEventHandler = callback
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      // Clean up any stale socket
      if (fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath)
        } catch {
          // ignore
        }
      }

      this.server = http.createServer((req, res) => {
        // Only accept POST requests to /event or /
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}') as HookEventPayload
              const panelId = data.panelId || (req.headers['x-panel-id'] as string)
              const rawEvent = (data.event || '').toLowerCase()
              const detail = data.detail

              let status: PanelStatus = 'running'
              if (rawEvent.includes('wait') || rawEvent.includes('permission') || rawEvent.includes('prompt') || rawEvent.includes('ask')) {
                status = 'waiting'
              } else if (rawEvent.includes('done') || rawEvent.includes('stop') || rawEvent.includes('finish') || rawEvent.includes('complete')) {
                status = 'done'
              } else if (rawEvent.includes('run') || rawEvent.includes('start') || rawEvent.includes('active')) {
                status = 'running'
              } else if (rawEvent.includes('idle')) {
                status = 'idle'
              }

              if (panelId && this.onEventHandler) {
                this.onEventHandler(panelId, status, detail)
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: true, status }))
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err)
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid JSON', message }))
            }
          })
        } else if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        } else {
          res.writeHead(404)
          res.end()
        }
      })

      // Listen on Unix domain socket
      this.server.listen(this.socketPath, () => {
        console.log(`[HookServer] Listening on unix socket: ${this.socketPath}`)
        resolve()
      })

      this.server.on('error', (err) => {
        console.error('[HookServer] Error:', err)
      })
    })
  }

  public stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath)
      } catch {
        // ignore
      }
    }
  }
}
