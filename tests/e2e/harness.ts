import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import electronPath from 'electron'

// Drives the test build of the app (out-e2e/, built with MYTERM_TEST_HOOKS=1
// by `npm run test:e2e`): the renderer through the Chrome DevTools Protocol,
// the main process through the Node inspector. The app runs with its own
// --user-data-dir, so the real saved state is never touched.

const PROJECT_ROOT = path.resolve(__dirname, '../..')
export const APP_DIR = path.join(PROJECT_ROOT, 'out-e2e')

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
    // A quitting app closes the connection; nothing waits forever.
    ws.onclose = () => {
      for (const resolve of this.pending.values()) resolve({ error: { message: 'connection closed' } })
      this.pending.clear()
    }
  }

  /** The renderer page, through Chromium's remote debugging port. */
  static async connect(port: number): Promise<Cdp> {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
      type: string
      webSocketDebuggerUrl: string
    }>
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error(`No page target: ${JSON.stringify(targets)}`)
    const cdp = await Cdp.connectUrl(page.webSocketDebuggerUrl)
    await cdp.send('Log.enable')
    return cdp
  }

  /** Any inspector WebSocket, e.g. the main process's Node inspector. */
  static async connectUrl(url: string): Promise<Cdp> {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    const cdp = new Cdp(ws)
    await cdp.send('Runtime.enable')
    return cdp
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = this.nextId++
    if (this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ id, error: { message: 'connection closed' } })
    }
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluates `expression` in the page and returns its (JSON) value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const { result, error } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (error) throw new Error(`Evaluation failed: ${expression}\n${error.message}`)
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
    throw new Error(`Timed out waiting for ${label} (last value: ${JSON.stringify(last)})\nConsole: ${this.consoleLines.join('\n')}`)
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
  }
}

interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { message: string }
}

export interface RunningApp {
  /** The renderer page. */
  cdp: Cdp
  /** The main process; `__mytermMain` holds its test hooks. */
  main: Cdp
  process: ChildProcess
  /** Everything the app wrote to stdout and stderr so far. */
  output(): string
  /** Resolves when the app process exits. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  stop(): Promise<void>
}

const INSPECTOR_URL = /Debugger listening on (ws:\/\/\S+)/
// Printed when the main process is done but the inspector keeps it alive.
const INSPECTOR_HOLD = 'Waiting for the debugger to disconnect'

function ensureAppBuilt(): void {
  if (!fs.existsSync(path.join(APP_DIR, 'main', 'index.js'))) {
    throw new Error(`No test build in ${APP_DIR}. Run: npm run test:e2e`)
  }
  // electron-vite writes only the bundles; Electron needs a package.json
  // that points at the main script (and names the app).
  fs.writeFileSync(
    path.join(APP_DIR, 'package.json'),
    JSON.stringify({ name: 'myterm', main: 'main/index.js' })
  )
}

export async function launchApp(userDataDir: string, env: Record<string, string>): Promise<RunningApp> {
  ensureAppBuilt()
  const portFile = path.join(userDataDir, 'DevToolsActivePort')
  fs.rmSync(portFile, { force: true })

  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, MYTERM_DEBUG: '1' }
  delete childEnv.ELECTRON_RENDERER_URL
  delete childEnv.ELECTRON_RUN_AS_NODE

  const child = spawn(
    electronPath as unknown as string,
    [APP_DIR, `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--inspect=0'],
    { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal }))
  )
  let output = ''
  let main: Cdp | null = null
  let cdp: Cdp | null = null
  const onOutput = (data: Buffer): void => {
    output += data
    // The app has quit; let the process exit.
    if (String(data).includes(INSPECTOR_HOLD)) {
      main?.close()
      cdp?.close()
    }
  }
  child.stdout?.on('data', onOutput)
  child.stderr?.on('data', onOutput)

  const started = Date.now()
  const waitUntil = async <T>(read: () => T | null, label: string): Promise<T> => {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`App exited early:\n${output}`)
      if (Date.now() - started > 20000) throw new Error(`No ${label}:\n${output}`)
      const value = read()
      if (value) return value
      await delay(100)
    }
  }

  const inspectorUrl = await waitUntil(() => INSPECTOR_URL.exec(output)?.[1] ?? null, 'inspector URL')
  main = await Cdp.connectUrl(inspectorUrl)
  await main.waitFor('!!globalThis.__mytermMain', 'main process test hooks', 20000)

  // Chromium writes the chosen debugging port into the user data dir.
  const port = await waitUntil(
    () =>
      fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || null : null,
    'DevTools port'
  )
  while (!cdp) {
    cdp = await Cdp.connect(port).catch(async (err) => {
      if (Date.now() - started > 20000) throw err
      await delay(200)
      return null
    })
  }

  return {
    cdp,
    main,
    process: child,
    output: () => output,
    exited,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(timer)
      }
      main?.close()
      cdp?.close()
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
