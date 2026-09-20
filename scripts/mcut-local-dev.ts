import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_STUDIO_PORT = 3000
export const DEFAULT_BRIDGE_PORT = 44737
export const DEFAULT_BRIDGE_TOKEN = 'mcut-local-dev'

const REPO_ROOT = join(import.meta.dir, '..')
const DESKTOP_DIR = join(REPO_ROOT, 'apps/desktop')
const ELECTRON_BINARIES = [join(DESKTOP_DIR, 'node_modules/.bin/electron'), join(REPO_ROOT, 'node_modules/.bin/electron')]
const DEV_SERVER_TIMEOUT_MS = 120_000

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

async function runToCompletion(name: string, cmd: string[], cwd?: string): Promise<void> {
  const child = spawnProcess(name, cmd, { cwd })
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`${name} failed with exit code ${code ?? 'unknown'}.`)
  }
}

async function prepareDevPackages(filters: string[]): Promise<void> {
  await runToCompletion('package builds', [bunBin(), 'run', 'turbo', 'run', 'build', ...filters.map((filter) => `--filter=${filter}`)])
}

async function waitForFirstExit(children: { name: string; proc: Bun.Subprocess }[], expected: () => boolean): Promise<number> {
  const first = await Promise.race(
    children.map(async (child) => ({
      name: child.name,
      code: await child.proc.exited,
    })),
  )
  for (const child of children) {
    if (child.proc.exitCode === null) child.proc.kill()
  }
  await Promise.allSettled(children.map((child) => child.proc.exited))
  if (expected()) return 0
  console.error(`[mcut dev] ${first.name} exited with code ${first.code ?? 'unknown'}`)
  return 1
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

async function waitForDevServer(url: string, server: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + DEV_SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The Next dev server exited with code ${server.exitCode} before it accepted connections.`)
    try {
      await fetch(url, { method: 'HEAD' })
      return
    } catch {
      await Bun.sleep(250)
    }
  }
  throw new Error(`The Next dev server did not accept connections at ${url} within ${DEV_SERVER_TIMEOUT_MS / 1000} seconds.`)
}

async function echoAppOutput(stdout: ReadableStream<Uint8Array>): Promise<void> {
  let buffered = ''
  for await (const chunk of stdout) {
    buffered += new TextDecoder().decode(chunk)
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line.startsWith('MCP_URL ')) console.error(`[mcut dev] MCP: ${line.slice('MCP_URL '.length)}`)
      console.log(line)
      newline = buffered.indexOf('\n')
    }
  }
}

async function runDev(): Promise<void> {
  const studioPort = localStudioPort()
  const devUrl = `http://localhost:${studioPort}`

  await prepareDevPackages(['mcut-studio^...', 'mcut-desktop^...'])
  await runToCompletion('desktop main build', [bunBin(), 'x', 'tsdown'], DESKTOP_DIR)

  console.error(`[mcut dev] Studio dev server: ${devUrl}`)

  const studio = spawnProcess('next dev', [bunBin(), 'run', '--cwd', 'apps/studio', 'dev', '--', '--port', String(studioPort)])
  const children = [{ name: 'next dev', proc: studio }]
  let shuttingDown = false

  const stop = () => {
    shuttingDown = true
    for (const child of children) {
      if (child.proc.exitCode === null) child.proc.kill()
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)

  try {
    await waitForDevServer(devUrl, studio)
  } catch (error) {
    stop()
    throw error
  }

  const app = spawnProcess('electron', [electronBinary(), DESKTOP_DIR], { env: electronEnv(devUrl), stdout: 'pipe' })
  children.push({ name: 'electron', proc: app })
  if (app.stdout instanceof ReadableStream) void echoAppOutput(app.stdout)

  process.exitCode = await waitForFirstExit(children, () => shuttingDown)
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
