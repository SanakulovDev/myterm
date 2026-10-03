import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import electronPath from 'electron'

// Drives the built app (out/) through the Chrome DevTools Protocol. The app
// runs with its own --user-data-dir, so the real saved state is never touched.

const PROJECT_ROOT = path.resolve(__dirname, '../..')

export class Cdp {
  private nextId = 1
  private readonly pending = new Map<number, (message: CdpMessage) => void>()
  /** Every console and browser log line the page produced. */
  readonly consoleLines: string[] = []

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(message)
        this.pending.delete(message.id)
      } else if (message.method === 'Runtime.consoleAPICalled') {
        const args = (message.params?.args ?? []) as Array<{ value?: unknown; description?: string }>
        this.consoleLines.push(args.map((a) => String(a.value ?? a.description ?? '')).join(' '))
      } else if (message.method === 'Log.entryAdded') {
        this.consoleLines.push(String((message.params?.entry as { text?: string })?.text ?? ''))
      }
    }
  }

  static async connect(port: number): Promise<Cdp> {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
      type: string
      webSocketDebuggerUrl: string
    }>
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error(`No page target: ${JSON.stringify(targets)}`)
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    const cdp = new Cdp(ws)
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    return cdp
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluates `expression` in the page and returns its (JSON) value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const { result } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    const r = result as { exceptionDetails?: unknown; result?: { value?: T } }
    if (r.exceptionDetails) {
      throw new Error(`Evaluation failed: ${expression}\n${JSON.stringify(r.exceptionDetails)}`)
    }
    return r.result?.value as T
  }

  /** Polls `expression` until it returns a truthy value. */
  async waitFor<T = unknown>(expression: string, label: string, timeoutMs = 15000): Promise<T> {
    const started = Date.now()
    let last: T | undefined
    while (Date.now() - started < timeoutMs) {
      last = await this.eval<T>(expression).catch(() => undefined)
      if (last) return last
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${label} (last value: ${JSON.stringify(last)})`)
  }

  close(): void {
    this.ws.close()
  }
}

interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

export interface RunningApp {
  cdp: Cdp
  process: ChildProcess
  stop(): Promise<void>
}

export async function launchApp(userDataDir: string, env: Record<string, string>): Promise<RunningApp> {
  const portFile = path.join(userDataDir, 'DevToolsActivePort')
  fs.rmSync(portFile, { force: true })

  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, MYTERM_DEBUG: '1' }
  delete childEnv.ELECTRON_RENDERER_URL
  delete childEnv.ELECTRON_RUN_AS_NODE

  const child = spawn(
    electronPath as unknown as string,
    [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0'],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  child.stdout?.on('data', (d) => (output += d))
  child.stderr?.on('data', (d) => (output += d))

  // Chromium writes the chosen debugging port into the user data dir.
  const started = Date.now()
  let port = 0
  while (!port) {
    if (child.exitCode !== null) throw new Error(`App exited early:\n${output}`)
    if (Date.now() - started > 20000) throw new Error(`No DevTools port:\n${output}`)
    if (fs.existsSync(portFile)) port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0])
    if (!port) await delay(100)
  }

  let cdp: Cdp | null = null
  while (!cdp) {
    cdp = await Cdp.connect(port).catch(async (err) => {
      if (Date.now() - started > 20000) throw err
      await delay(200)
      return null
    })
  }

  return {
    cdp,
    process: child,
    async stop() {
      cdp?.close()
      if (child.exitCode !== null) return
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited
      clearTimeout(timer)
    }
  }
}

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
