export const DEFAULT_STUDIO_PORT = 3000
export const DEFAULT_BRIDGE_PORT = 44737
export const DEFAULT_BRIDGE_TOKEN = 'mcut-local-dev'

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
  return integerEnv('MCUT_STUDIO_PORT') ?? integerEnv('CONDUCTOR_PORT') ?? DEFAULT_STUDIO_PORT
}

export function localBridgePort(): number {
  const configured = integerEnv('MCUT_BRIDGE_PORT')
  if (configured !== undefined) return configured

  const conductorPort = integerEnv('CONDUCTOR_PORT')
  if (conductorPort !== undefined) {
    const bridgePort = conductorPort + 1
    if (bridgePort > 65535) {
      throw new Error('CONDUCTOR_PORT is too high to derive MCUT_BRIDGE_PORT as CONDUCTOR_PORT + 1.')
    }
    return bridgePort
  }

  return DEFAULT_BRIDGE_PORT
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

function spawnProcess(name: string, cmd: string[]): Bun.Subprocess {
  console.error(`[mcut-dev] starting ${name}: ${cmd.join(' ')}`)
  return Bun.spawn(cmd, {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

function bunBin(): string {
  return process.execPath
}

async function prepareDevPackages(filters: string[]): Promise<void> {
  const cmd = [
    bunBin(),
    'run',
    'turbo',
    'run',
    'build',
    ...filters.map((filter) => `--filter=${filter}`),
  ]
  console.error(`[mcut-dev] preparing package builds: ${cmd.join(' ')}`)
  const child = spawnProcess('package builds', cmd)
  const code = await child.exited
  if (code !== 0) {
    throw new Error(`Package build preparation failed with exit code ${code ?? 'unknown'}.`)
  }
}

async function waitForFirstExit(children: Bun.Subprocess[]): Promise<number> {
  const code = await Promise.race(children.map((child) => child.exited))
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
  await Promise.allSettled(children.map((child) => child.exited))
  return code ?? 0
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

async function runDev(): Promise<void> {
  const studioPort = localStudioPort()
  const bridgePort = localBridgePort()

  await prepareDevPackages(['mcut-studio-web^...'])

  console.error(`[mcut-dev] Studio: http://localhost:${studioPort}`)
  console.error(`[mcut-dev] Bridge: ws://127.0.0.1:${bridgePort}/mcut-mcp`)
  console.error(`[mcut-dev] MCP: ${localMcpUrl()}`)
  console.error(`[mcut-dev] Open editor: ${localEditorBridgeUrl()}`)

  const children = [
    spawnProcess('studio', [
      bunBin(),
      'run',
      '--cwd',
      'apps/studio',
      'dev',
      '--',
      '--port',
      String(studioPort),
    ]),
    spawnProcess('mcp bridge', [
      bunBin(),
      'packages/mcp-server/src/bridge-cli.ts',
      'start',
      '--port',
      String(bridgePort),
      '--token',
      localBridgeToken(),
      '--editor-url',
      localEditorUrl(),
    ]),
  ]

  const stop = () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill()
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('SIGHUP', stop)

  process.exitCode = await waitForFirstExit(children)
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
