import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { z } from 'zod'
import { repoRoot } from './fixtures'

export interface BridgeSession {
  mcpUrl: string
  editorUrl: string
  bridgePort: number
  token: string
  close(): Promise<void>
}

export interface BridgeSessionOptions {
  logDir: string
  headless?: boolean
  readyTimeoutMs?: number
  log?: (line: string) => void
}

export class BridgeSessionError extends Error {}

const STUDIO_DIR = join(repoRoot, 'apps/studio')
const NEXT_BIN = join(STUDIO_DIR, 'node_modules/next/dist/bin/next')
const BRIDGE_CLI = join(repoRoot, 'packages/mcp-server/src/bridge-cli.ts')
const DEFAULT_READY_TIMEOUT_MS = 90_000
const STATUS_POLL_MS = 100
const KILL_GRACE_MS = 5_000
const LOG_TAIL_LINES = 30

const BRIDGE_READY = /ws:\/\/127\.0\.0\.1:(\d+)\/mcut-mcp/
const STUDIO_LOCAL = /Local:\s+http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/
const STUDIO_READY = /Ready in/

const statusSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    connected: z.boolean(),
    tab: z.unknown().nullable(),
  }),
})

type LineTest = (line: string) => boolean

interface Child {
  name: string
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  tail: string[]
  waiters: Set<{ test: LineTest; resolve: (line: string) => void }>
}

interface Deadline {
  endsAt: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const remainingMs = (deadline: Deadline): number => Math.max(0, deadline.endsAt - Date.now())

async function tapLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true })
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      onLine(buffered.slice(0, newline).replace(/\r$/, ''))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  }
  if (buffered.length > 0) onLine(buffered)
}

class ProcessGroup {
  private readonly children: Child[] = []
  private readonly logs: WriteStream[] = []

  constructor(
    private readonly logDir: string,
    private readonly log: (line: string) => void,
  ) {}

  spawn(name: string, cmd: string[], cwd: string): Child {
    const logFile = createWriteStream(join(this.logDir, `${name}.log`))
    this.logs.push(logFile)
    const proc = Bun.spawn(cmd, { cwd, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const child: Child = { name, proc, tail: [], waiters: new Set() }
    const onLine = (line: string): void => {
      logFile.write(`${line}\n`)
      child.tail.push(line)
      if (child.tail.length > LOG_TAIL_LINES) child.tail.shift()
      for (const waiter of child.waiters) {
        if (waiter.test(line)) {
          child.waiters.delete(waiter)
          waiter.resolve(line)
        }
      }
    }
    void tapLines(proc.stdout, onLine)
    void tapLines(proc.stderr, onLine)
    this.children.push(child)
    this.log(`started ${name} (pid ${proc.pid}): ${cmd.join(' ')}`)
    return child
  }

  waitForLine(child: Child, what: string, test: LineTest, deadline: Deadline): Promise<string> {
    const already = child.tail.find(test)
    if (already !== undefined) return Promise.resolve(already)
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const waiter = {
        test,
        resolve: (line: string) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(line)
        },
      }
      const fail = (message: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.waiters.delete(waiter)
        reject(new BridgeSessionError(`${message}\n${child.tail.join('\n')}`))
      }
      const timer = setTimeout(() => fail(`${child.name} did not print its ${what} line within the ready timeout.`), remainingMs(deadline))
      child.waiters.add(waiter)
      void child.proc.exited.then((code) => fail(`${child.name} exited with code ${code} before it printed its ${what} line.`))
    })
  }

  tails(): string {
    return this.children.map((child) => `[${child.name}]\n${child.tail.join('\n')}`).join('\n')
  }

  readonly killAllSync = (): void => {
    for (const child of this.children) {
      if (child.proc.exitCode === null) child.proc.kill('SIGKILL')
    }
  }

  async shutdown(): Promise<void> {
    for (const child of this.children) {
      if (child.proc.exitCode === null) child.proc.kill('SIGTERM')
    }
    const graceful = Promise.all(this.children.map((child) => child.proc.exited))
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), KILL_GRACE_MS)
    })
    const outcome = await Promise.race([graceful.then(() => 'exited' as const), grace])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      for (const child of this.children) {
        if (child.proc.exitCode === null) {
          this.log(`${child.name} ignored SIGTERM for ${KILL_GRACE_MS} ms, sending SIGKILL`)
          child.proc.kill('SIGKILL')
        }
      }
      await graceful
    }
    for (const child of this.children) {
      this.log(`${child.name} exited with ${child.proc.signalCode ?? `code ${child.proc.exitCode}`}`)
    }
    for (const file of this.logs) file.end()
  }
}

function portFrom(line: string, pattern: RegExp, what: string): number {
  const port = Number(pattern.exec(line)?.[1])
  if (!Number.isInteger(port) || port <= 0) throw new BridgeSessionError(`could not read the ${what} port from "${line}"`)
  return port
}

async function readStatus(bridgePort: number): Promise<string | { connected: boolean; tab: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/status`)
    const parsed = statusSchema.safeParse(await response.json())
    if (!parsed.success) return `unexpected /status body (${response.status})`
    return parsed.data.result
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const describeStatus = (status: { connected: boolean; tab: unknown }): string =>
  `connected ${status.connected}, hello frame ${status.tab === null ? 'not yet received' : 'received'}`

async function waitForTab(bridgePort: number, deadline: Deadline, log: (line: string) => void): Promise<void> {
  let last = 'no status response yet'
  while (remainingMs(deadline) > 0) {
    const status = await readStatus(bridgePort)
    if (typeof status !== 'string' && status.connected && status.tab !== null) {
      log(`studio tab connected, hello frame ${JSON.stringify(status.tab)}`)
      return
    }
    last = typeof status === 'string' ? status : describeStatus(status)
    await sleep(STATUS_POLL_MS)
  }
  throw new BridgeSessionError(`the Studio tab did not connect to the bridge in time. Last /status: ${last}`)
}

async function openStudioTab(
  editorUrl: string,
  options: { headless: boolean; logDir: string; log: (line: string) => void },
): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({ headless: options.headless })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await context.tracing.start({ screenshots: true, snapshots: true })
  const browserLog = createWriteStream(join(options.logDir, 'browser.log'))
  const page = await context.newPage()
  page.on('console', (message) => browserLog.write(`[${message.type()}] ${message.text()}\n`))
  page.on('pageerror', (error) => {
    browserLog.write(`[pageerror] ${error.message}\n`)
    options.log(`page error: ${error.message}`)
  })
  page.on('close', () => browserLog.end())
  options.log(`opening ${editorUrl}`)
  const response = await page.goto(editorUrl, { waitUntil: 'load' })
  if (response === null || !response.ok()) {
    throw new BridgeSessionError(`GET ${editorUrl} answered ${response?.status() ?? 'nothing'}`)
  }
  return { browser, context }
}

export async function openBridgeSession(options: BridgeSessionOptions): Promise<BridgeSession> {
  const log = options.log ?? ((line: string) => console.error(`[bridge-session] ${line}`))
  const headless = options.headless ?? true
  const deadline: Deadline = { endsAt: Date.now() + (options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS) }
  if (!existsSync(join(STUDIO_DIR, '.next/BUILD_ID'))) {
    throw new BridgeSessionError('apps/studio has no production build. Run `bun run build` first.')
  }
  const node = Bun.which('node')
  if (node === null) throw new BridgeSessionError('node is not on PATH and next start needs it.')
  mkdirSync(options.logDir, { recursive: true })

  const token = randomBytes(16).toString('hex')
  const group = new ProcessGroup(options.logDir, log)
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let closed = false

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    process.off('exit', group.killAllSync)
    if (context !== undefined) {
      await context.tracing.stop({ path: join(options.logDir, 'trace.zip') }).catch((error: unknown) => {
        log(`trace not saved: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    await browser?.close().catch((error: unknown) => {
      log(`browser close failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    await group.shutdown()
  }
  const onSignal = (signal: NodeJS.Signals): void => {
    log(`received ${signal}, tearing down`)
    void close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  process.on('exit', group.killAllSync)

  try {
    const studio = group.spawn('studio', [node, NEXT_BIN, 'start', '--port', '0', '--hostname', '127.0.0.1'], STUDIO_DIR)
    const bridge = group.spawn('bridge', [process.execPath, BRIDGE_CLI, 'start', '--port', '0', '--token', token], repoRoot)
    const bridgeLine = await group.waitForLine(bridge, 'ready', (line) => BRIDGE_READY.test(line), deadline)
    const bridgePort = portFrom(bridgeLine, BRIDGE_READY, 'bridge')
    const studioLine = await group.waitForLine(studio, 'Local URL', (line) => STUDIO_LOCAL.test(line), deadline)
    const studioPort = portFrom(studioLine, STUDIO_LOCAL, 'studio')
    await group.waitForLine(studio, 'Ready', (line) => STUDIO_READY.test(line), deadline)
    log(`bridge listening on ${bridgePort}, studio listening on ${studioPort}`)

    const editorUrl = new URL(`http://127.0.0.1:${studioPort}/editor`)
    editorUrl.searchParams.set('mcpBridge', String(bridgePort))
    editorUrl.searchParams.set('mcpToken', token)
    const tab = await openStudioTab(editorUrl.toString(), { headless, logDir: options.logDir, log })
    browser = tab.browser
    context = tab.context
    await waitForTab(bridgePort, deadline, log)

    const mcpUrl = new URL(`http://127.0.0.1:${bridgePort}/mcp`)
    mcpUrl.searchParams.set('token', token)
    return { mcpUrl: mcpUrl.toString(), editorUrl: editorUrl.toString(), bridgePort, token, close }
  } catch (error) {
    await close()
    const message = error instanceof Error ? error.message : String(error)
    throw new BridgeSessionError(`${message}\n\nprocess output:\n${group.tails()}`)
  }
}
