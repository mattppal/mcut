import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_STUDIO_PORT = 3000
export const DEFAULT_BRIDGE_PORT = 44737
export const DEFAULT_BRIDGE_TOKEN = 'mcut-local-dev'

const REPO_ROOT = join(import.meta.dir, '..')
const DESKTOP_DIR = join(REPO_ROOT, 'apps/desktop')
const IPC_DIR = join(REPO_ROOT, 'packages/desktop-ipc')
const ELECTRON_BINARIES = [join(DESKTOP_DIR, 'node_modules/.bin/electron'), join(REPO_ROOT, 'node_modules/.bin/electron')]
const TSDOWN_BIN = join(REPO_ROOT, 'node_modules/.bin/tsdown')
const TSC_BIN = join(REPO_ROOT, 'node_modules/.bin/tsc')
const MAIN_INSPECT_PORT = 9229
const RENDERER_DEBUG_PORT = 9222
const WATCH_DEBOUNCE_MS = 25

function integerEnv(name: string): number | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer port between 0 and 65535.`)
  }
  return port
}

export function localStudioPort(): number {
  return integerEnv('MCUT_STUDIO_PORT') ?? DEFAULT_STUDIO_PORT
}

export function localBridgePort(): number {
  return integerEnv('MCUT_BRIDGE_PORT') ?? DEFAULT_BRIDGE_PORT
}

export function localBridgeToken(): string {
  return process.env.MCUT_BRIDGE_TOKEN || DEFAULT_BRIDGE_TOKEN
}

export function localEditorUrl(): string {
  return process.env.MCUT_EDITOR_URL || `http://localhost:${localStudioPort()}/editor`
}

export function localEditorBridgeUrl(): string {
  const url = new URL(localEditorUrl())
  url.searchParams.set('mcpBridge', String(localBridgePort()))
  url.searchParams.set('mcpToken', localBridgeToken())
  return url.toString()
}

export function localMcpUrl(): string {
  const url = new URL(`http://127.0.0.1:${localBridgePort()}/mcp`)
  url.searchParams.set('token', localBridgeToken())
  return url.toString()
}

interface SpawnOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdout?: 'inherit' | 'pipe'
}

interface RebuildStep {
  name: string
  cmd: string[]
  cwd: string
}

interface SourceWatch {
  name: string
  dir: string
  steps: RebuildStep[]
}

function spawnProcess(name: string, cmd: string[], options: SpawnOptions = {}): Bun.Subprocess {
  console.error(`[mcut dev] starting ${name}: ${cmd.join(' ')}`)
  return Bun.spawn(cmd, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdin: 'inherit',
    stdout: options.stdout ?? 'inherit',
    stderr: 'inherit',
  })
}

function bunBin(): string {
  return process.execPath
}

const DESKTOP_BUILD: RebuildStep = { name: 'desktop main build', cmd: [bunBin(), TSDOWN_BIN], cwd: DESKTOP_DIR }

const SOURCE_WATCHES: SourceWatch[] = [
  { name: 'apps/desktop/src', dir: join(DESKTOP_DIR, 'src'), steps: [DESKTOP_BUILD] },
  {
    name: 'packages/desktop-ipc/src',
    dir: join(IPC_DIR, 'src'),
    steps: [
      { name: 'desktop-ipc build', cmd: [bunBin(), TSDOWN_BIN], cwd: IPC_DIR },
      { name: 'desktop typecheck', cmd: [bunBin(), TSC_BIN, '--noEmit'], cwd: DESKTOP_DIR },
      DESKTOP_BUILD,
    ],
  },
]

function runStep(step: RebuildStep): Promise<number | null> {
  return spawnProcess(step.name, step.cmd, { cwd: step.cwd }).exited
}

async function runToCompletion(step: RebuildStep): Promise<void> {
  const code = await runStep(step)
  if (code !== 0) {
    throw new Error(`${step.name} failed with exit code ${code ?? 'unknown'}.`)
  }
}

async function prepareDevPackages(filters: string[]): Promise<void> {
  await runToCompletion({
    name: 'package builds',
    cmd: [bunBin(), 'run', 'turbo', 'run', 'build', ...filters.map((filter) => `--filter=${filter}`)],
    cwd: REPO_ROOT,
  })
}

async function runBridge(): Promise<void> {
  await prepareDevPackages(['@mcut/mcp-server...'])
  const child = spawnProcess('mcp bridge', [
    bunBin(),
    'packages/mcp-server/src/bridge-cli.ts',
    'start',
    '--port',
    String(localBridgePort()),
    '--token',
    localBridgeToken(),
    '--editor-url',
    localEditorUrl(),
  ])
  process.exitCode = await child.exited
}

function electronBinary(): string {
  const found = ELECTRON_BINARIES.find(existsSync)
  if (found === undefined) throw new Error(`No electron binary at ${ELECTRON_BINARIES.join(' or ')}. Run \`bun install\` first.`)
  return found
}

function electronEnv(devUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MCUT_DEV_URL: devUrl }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function eachLine(stdout: ReadableStream<Uint8Array>, write: (line: string) => void): Promise<void> {
  let buffered = ''
  for await (const chunk of stdout) {
    buffered += new TextDecoder().decode(chunk)
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      write(buffered.slice(0, newline))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  }
  if (buffered.length > 0) write(buffered)
}

async function echoAppOutput(stdout: ReadableStream<Uint8Array>): Promise<void> {
  await eachLine(stdout, (line) => {
    if (line.startsWith('MCP_URL ')) console.error(`[mcut dev] MCP: ${line.slice('MCP_URL '.length)}`)
    console.log(line)
  })
}

function waitForReady(studio: Bun.Subprocess): Promise<void> {
  const stdout = studio.stdout
  if (!(stdout instanceof ReadableStream)) {
    return Promise.reject(new Error('The Next dev server has no stdout stream.'))
  }
  return new Promise((resolve, reject) => {
    let ready = false
    const fail = (code: number | null) => {
      if (!ready) reject(new Error(`The Next dev server exited with code ${code ?? 'unknown'} before it was ready.`))
    }
    void eachLine(stdout, (line) => {
      console.log(line)
      if (!ready && line.includes('Ready in')) {
        ready = true
        resolve()
      }
    })
    void studio.exited.then((code) => fail(code))
  })
}

class DesktopApp {
  proc: Bun.Subprocess | undefined
  generation = 0
  readonly exited: Promise<void>
  private readonly markExited: () => void
  private closed = false
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly devUrl: string) {
    const settled = Promise.withResolvers<void>()
    this.exited = settled.promise
    this.markExited = settled.resolve
  }

  launch(): void {
    const proc = spawnProcess('electron', [electronBinary(), `--inspect=${MAIN_INSPECT_PORT}`, `--remote-debugging-port=${RENDERER_DEBUG_PORT}`, DESKTOP_DIR], {
      env: electronEnv(this.devUrl),
      stdout: 'pipe',
    })
    this.proc = proc
    if (proc.stdout instanceof ReadableStream) void echoAppOutput(proc.stdout)
    const gen = this.generation
    void proc.exited.then(() => {
      if (gen === this.generation) this.markExited()
    })
  }

  relaunch(): Promise<void> {
    const next = this.chain.then(async () => {
      if (this.closed) return
      this.generation += 1
      const previous = this.proc
      previous?.kill()
      if (previous !== undefined) await previous.exited
      if (this.closed) return
      this.launch()
    })
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  kill(): void {
    this.closed = true
    this.generation += 1
    this.proc?.kill()
  }
}

function watchSources(source: SourceWatch, app: DesktopApp): FSWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let dirty = false

  const runSteps = async (): Promise<boolean> => {
    for (const step of source.steps) {
      const code = await runStep(step)
      if (code === 0) continue
      console.error(`[mcut dev] ${step.name} failed with exit code ${code ?? 'unknown'}, the running app is unchanged`)
      return false
    }
    return true
  }

  const runPipeline = async () => {
    running = true
    do {
      dirty = false
      const started = Date.now()
      if (await runSteps()) {
        await app.relaunch()
        console.error(`[mcut dev] ${source.name} changed, rebuilt and relaunched in ${Date.now() - started} ms`)
      }
    } while (dirty)
    running = false
  }

  return watch(source.dir, (_event, filename) => {
    if (typeof filename !== 'string' || !filename.endsWith('.ts')) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (running) {
        dirty = true
        return
      }
      void runPipeline()
    }, WATCH_DEBOUNCE_MS)
  })
}

async function runDev(): Promise<void> {
  const studioPort = localStudioPort()
  const devUrl = `http://localhost:${studioPort}`

  await prepareDevPackages(['mcut-studio^...', 'mcut-desktop^...'])
  await runToCompletion(DESKTOP_BUILD)

  console.error(`[mcut dev] Studio dev server: ${devUrl}`)

  const studio = spawnProcess('next dev', [bunBin(), 'run', '--cwd', 'apps/studio', 'dev', '--', '--port', String(studioPort)], { stdout: 'pipe' })
  const app = new DesktopApp(devUrl)
  const watchers: FSWatcher[] = []
  let signalled = false

  const stop = () => {
    for (const watcher of watchers) watcher.close()
    watchers.length = 0
    if (studio.exitCode === null) studio.kill()
    app.kill()
  }
  const onSignal = () => {
    signalled = true
    stop()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  process.once('SIGHUP', onSignal)

  try {
    await waitForReady(studio)
  } catch (error) {
    stop()
    throw error
  }

  app.launch()
  for (const source of SOURCE_WATCHES) watchers.push(watchSources(source, app))

  const first = await Promise.race([
    studio.exited.then((code) => ({ name: 'next dev', code })),
    app.exited.then(() => ({ name: 'electron', code: app.proc?.exitCode ?? null })),
  ])
  stop()
  await Promise.allSettled([studio.exited, app.proc === undefined ? Promise.resolve() : app.proc.exited])
  if (signalled) {
    process.exitCode = 0
    return
  }
  console.error(`[mcut dev] ${first.name} exited with code ${first.code ?? 'unknown'}`)
  process.exitCode = 1
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dev'
  switch (command) {
    case 'dev':
      await runDev()
      return
    case 'bridge':
      await runBridge()
      return
    case 'mcp-url':
      console.log(localMcpUrl())
      return
    case 'url':
      console.log(localEditorBridgeUrl())
      return
    default:
      throw new Error(`Unknown mcut local dev command "${command}". Expected dev, bridge, url, or mcp-url.`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
