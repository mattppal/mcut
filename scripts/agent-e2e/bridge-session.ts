import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { startFixtureServer, type FixtureServer } from './fixture-server'
import { repoRoot } from './fixtures'

export interface BridgeSession {
  mcpUrl: string
  mediaOrigin: string
  lost: Promise<never>
  close(): Promise<void>
}

export interface BridgeSessionOptions {
  logDir: string
  readyTimeoutMs?: number
  remoteDebuggingPort?: number
  log?: (line: string) => void
}

export class BridgeSessionError extends Error {}

const DESKTOP_DIR = join(repoRoot, 'apps/desktop')
const DESKTOP_MAIN = join(DESKTOP_DIR, 'dist/main.mjs')
const ELECTRON_BINARIES = [join(DESKTOP_DIR, 'node_modules/.bin/electron'), join(repoRoot, 'node_modules/.bin/electron')]
const DEFAULT_READY_TIMEOUT_MS = 90_000
const STATUS_POLL_MS = 100
const STATUS_FETCH_TIMEOUT_MS = 2_000
const KILL_GRACE_MS = 5_000
const LOG_TAIL_LINES = 30

const BRIDGE_READY = /ws:\/\/127\.0\.0\.1:(\d+)\/mcut-mcp/

const statusSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    connected: z.boolean(),
    tab: z.unknown().nullable(),
  }),
})

type LineTest = (line: string) => boolean

interface Deadline {
  endsAt: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const remainingMs = (deadline: Deadline): number => Math.max(0, deadline.endsAt - Date.now())

export async function tapLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
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

function electronBinary(): string {
  const found = ELECTRON_BINARIES.find(existsSync)
  if (found === undefined) throw new BridgeSessionError(`no electron binary at ${ELECTRON_BINARIES.join(' or ')}. Run \`bun install\` first.`)
  return found
}

function electronEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

class DesktopApp {
  readonly proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  private readonly logFile: WriteStream
  private readonly tail: string[] = []
  private readonly waiters = new Set<{ test: LineTest; resolve: (line: string) => void }>()

  constructor(
    cmd: string[],
    logDir: string,
    private readonly log: (line: string) => void,
  ) {
    this.logFile = createWriteStream(join(logDir, 'app.log'))
    this.proc = Bun.spawn(cmd, { cwd: repoRoot, env: electronEnv(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    void tapLines(this.proc.stdout, this.onLine)
    void tapLines(this.proc.stderr, this.onLine)
    this.log(`started electron (pid ${this.proc.pid}): ${cmd.join(' ')}`)
  }

  private readonly onLine = (line: string): void => {
    this.logFile.write(`${line}\n`)
    this.tail.push(line)
    if (this.tail.length > LOG_TAIL_LINES) this.tail.shift()
    for (const waiter of this.waiters) {
      if (waiter.test(line)) {
        this.waiters.delete(waiter)
        waiter.resolve(line)
      }
    }
  }

  note(line: string): void {
    this.logFile.write(`[bridge-session] ${line}\n`)
    this.log(line)
  }

  waitForLine(what: string, test: LineTest, deadline: Deadline): Promise<string> {
    const already = this.tail.find(test)
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
        this.waiters.delete(waiter)
        reject(new BridgeSessionError(`${message}\n${this.tail.join('\n')}`))
      }
      const timer = setTimeout(() => fail(`electron did not print its ${what} line within the ready timeout.`), remainingMs(deadline))
      this.waiters.add(waiter)
      void this.proc.exited.then((code) => fail(`electron exited with code ${code} before it printed its ${what} line.`))
    })
  }

  output(): string {
    return this.tail.join('\n')
  }

  readonly killSync = (): void => {
    if (this.proc.exitCode === null) this.proc.kill('SIGKILL')
  }

  async shutdown(): Promise<void> {
    if (this.proc.exitCode === null) this.proc.kill('SIGTERM')
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), KILL_GRACE_MS)
    })
    const outcome = await Promise.race([this.proc.exited.then(() => 'exited' as const), grace])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      this.log(`electron ignored SIGTERM for ${KILL_GRACE_MS} ms, sending SIGKILL`)
      this.proc.kill('SIGKILL')
      await this.proc.exited
    }
    this.log(`electron exited with ${this.proc.signalCode ?? `code ${this.proc.exitCode}`}`)
    this.logFile.end()
  }
}

function portFrom(line: string): number {
  const port = Number(BRIDGE_READY.exec(line)?.[1])
  if (!Number.isInteger(port) || port <= 0) throw new BridgeSessionError(`could not read the bridge port from "${line}"`)
  return port
}

async function readStatus(bridgePort: number, deadline: Deadline): Promise<string | { connected: boolean; tab: unknown }> {
  try {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/status`, {
      signal: AbortSignal.timeout(Math.min(STATUS_FETCH_TIMEOUT_MS, remainingMs(deadline))),
    })
    const parsed = statusSchema.safeParse(await response.json())
    if (!parsed.success) return `unexpected /status body (${response.status})`
    return parsed.data.result
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const describeStatus = (status: { connected: boolean; tab: unknown }): string =>
  `connected ${status.connected}, hello frame ${status.tab === null ? 'not yet received' : 'received'}`

async function waitForTab(bridgePort: number, deadline: Deadline, app: DesktopApp): Promise<void> {
  let last = 'no status response yet'
  while (remainingMs(deadline) > 0) {
    const status = await readStatus(bridgePort, deadline)
    if (typeof status !== 'string' && status.connected && status.tab !== null) {
      app.note(`studio window connected, hello frame ${JSON.stringify(status.tab)}`)
      return
    }
    last = typeof status === 'string' ? status : describeStatus(status)
    await sleep(STATUS_POLL_MS)
  }
  throw new BridgeSessionError(`the Studio window did not connect to the bridge in time. Last /status: ${last}`)
}

export async function openBridgeSession(options: BridgeSessionOptions): Promise<BridgeSession> {
  const log = options.log ?? ((line: string) => console.error(`[bridge-session] ${line}`))
  const deadline: Deadline = { endsAt: Date.now() + (options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS) }
  if (!existsSync(DESKTOP_MAIN)) {
    throw new BridgeSessionError('apps/desktop/dist has no main.mjs. Run `bun run --cwd apps/desktop build` first.')
  }
  const electron = electronBinary()
  mkdirSync(options.logDir, { recursive: true })

  const token = randomBytes(32).toString('hex')
  const debugging = options.remoteDebuggingPort === undefined ? [] : [`--remote-debugging-port=${options.remoteDebuggingPort}`]
  const app = new DesktopApp([electron, DESKTOP_DIR, ...debugging, '--port', '0', '--token', token], options.logDir, log)
  let fixtures: FixtureServer | undefined
  let closing: Promise<void> | undefined

  const close = (): Promise<void> => {
    closing ??= (async () => {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      await fixtures?.stop()
      await app.shutdown()
      process.off('exit', app.killSync)
    })()
    return closing
  }
  const onSignal = (signal: NodeJS.Signals): void => {
    log(`received ${signal}, tearing down`)
    void (async () => {
      await close()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })()
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  process.on('exit', app.killSync)

  const lost = new Promise<never>((_, reject) => {
    void app.proc.exited.then((code) => {
      if (closing !== undefined) return
      reject(new BridgeSessionError(`the Electron app exited with ${app.proc.signalCode ?? `code ${code}`} while the session was open.\n${app.output()}`))
    })
  })
  lost.catch(() => undefined)

  try {
    fixtures = startFixtureServer()
    const bridgePort = portFrom(await app.waitForLine('BRIDGE_READY', (line) => BRIDGE_READY.test(line), deadline))
    log(`bridge listening on ${bridgePort}, fixtures served from ${fixtures.origin}`)
    await waitForTab(bridgePort, deadline, app)
    const mcpUrl = new URL(`http://127.0.0.1:${bridgePort}/mcp`)
    mcpUrl.searchParams.set('token', token)
    return { mcpUrl: mcpUrl.toString(), mediaOrigin: fixtures.origin, lost, close }
  } catch (error) {
    await close()
    const message = error instanceof Error ? error.message : String(error)
    throw new BridgeSessionError(`${message}\n\nelectron output:\n${app.output()}`)
  }
}
