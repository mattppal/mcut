import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { localMcpUrl } from '../mcut-local-dev'
import { openBridgeSession, type BridgeSession } from './bridge-session'
import { startFixtureServer } from './fixture-server'
import {
  GROK_INSTALL_COMMAND,
  GrokBuildAuthError,
  checkGrokHandshake,
  findGrokBinary,
  runGrokBuildTask,
  writeGrokProject,
} from './grok-build'
import { DEFAULT_CAPS, runTask, type Caps } from './loop'
import { connectMcp, createTransport, describeTarget, type McpSession, type McpTarget } from './mcp'
import { createScriptedModel } from './model'
import { buildReport, createRunDir, markdownTable, writeReport } from './report'
import { TASKS, createTasks, repoRelativeSrc, servedSrc, type MediaSrc } from './tasks'
import type { E2ETask, TaskRun } from './types'
import { DEFAULT_XAI_BASE_URL, DEFAULT_XAI_MODEL, createXaiModel } from './xai'

const EXIT_FAILED = 1
const EXIT_CONFIG = 2
const XAI_REQUEST_TIMEOUT_MS = 120_000
const GROK_SKIPPED = 'skipped: grok binary not found'

const USAGE = [
  'usage: bun scripts/agent-e2e/run.ts [--dry-run] [--target stdio|bridge] [--driver xai|grok-build] [--task <id>]... [--max-steps N] [--wall-clock-ms N] [--list]',
  '',
  'targets  stdio       the headless MCP server over stdio writing a temp project file (default)',
  '         bridge      a production Studio tab in headless Chromium connected through the live bridge',
  '',
  'drivers  xai         the harness loop calls the xAI Responses API and executes its tool calls (default)',
  '         grok-build  the grok CLI runs headless against the bridge from a temp project dir; needs --target bridge',
  '',
  'dry run  xai         replays each task\'s scripted tool calls, no model call',
  '         grok-build  checks that grok discovers the temp config and completes the MCP handshake, runs no task',
  '',
  'env  XAI_API_KEY        required unless --dry-run (grok reads it too)',
  `     XAI_MODEL          xai model id, default ${DEFAULT_XAI_MODEL}`,
  `     XAI_BASE_URL       API base, default ${DEFAULT_XAI_BASE_URL}`,
  '     GROK_BUILD_MODEL   model id passed to grok -m (empty lets grok pick)',
  '     GROK_BIN           path to the grok binary when it is not on PATH or in ~/.grok/bin',
  '     MCUT_BRIDGE_URL    full MCP URL of a running live bridge (token included as ?token=)',
  '     MCUT_BRIDGE_TOKEN  pair with a local bridge on MCUT_BRIDGE_PORT (default 44737) instead',
  '     MCUT_HEADED        set to 1 to watch the Studio tab when the target is bridge',
  '',
  `exit codes  0 all tasks passed (or "${GROK_SKIPPED}" on a dry run), 1 a task failed, 2 configuration error`,
].join('\n')

class ConfigError extends Error {}

type TargetName = 'stdio' | 'bridge'

type DriverName = 'xai' | 'grok-build'

interface Options {
  dryRun: boolean
  list: boolean
  target: TargetName
  driver: DriverName
  taskIds: string[]
  caps: Caps
}

type TaskRunner = (task: E2ETask) => Promise<TaskRun>

interface Connected {
  target: McpTarget
  srcOf: MediaSrc
  session: BridgeSession | undefined
  close(): Promise<void>
}

const log = (line: string): void => console.error(`[agent-e2e] ${line}`)

const integer = (raw: string | undefined, fallback: number, flag: string): number => {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${flag} must be a positive integer.`)
  return value
}

const envValue = (name: string): string | undefined => {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

function knownTaskId(id: string): string {
  if (TASKS.some((task) => task.id === id)) return id
  throw new ConfigError(`Unknown task "${id}". Known tasks. ${TASKS.map((entry) => entry.id).join(', ')}`)
}

function parseTarget(raw: string): TargetName {
  if (raw === 'stdio' || raw === 'bridge') return raw
  throw new ConfigError(`--target must be stdio or bridge, got "${raw}".`)
}

function parseDriver(raw: string, target: TargetName): DriverName {
  if (raw === 'xai') return raw
  if (raw !== 'grok-build') throw new ConfigError(`--driver must be xai or grok-build, got "${raw}".`)
  if (target !== 'bridge') throw new ConfigError('--driver grok-build needs --target bridge, grok connects to the live bridge.')
  return raw
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      target: { type: 'string', default: 'stdio' },
      driver: { type: 'string', default: 'xai' },
      task: { type: 'string', multiple: true, default: [] },
      'max-steps': { type: 'string' },
      'wall-clock-ms': { type: 'string' },
    },
  })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const target = parseTarget(values.target)
  return {
    dryRun: values['dry-run'],
    list: values.list,
    target,
    driver: parseDriver(values.driver, target),
    taskIds: values.task.map(knownTaskId),
    caps: {
      maxSteps: integer(values['max-steps'], DEFAULT_CAPS.maxSteps, '--max-steps'),
      wallClockMs: integer(values['wall-clock-ms'], DEFAULT_CAPS.wallClockMs, '--wall-clock-ms'),
    },
  }
}

function externalBridge(): McpTarget | undefined {
  const explicit = envValue('MCUT_BRIDGE_URL')
  const token = envValue('MCUT_BRIDGE_TOKEN')
  if (explicit !== undefined) {
    const url = new URL(explicit)
    if (token !== undefined && !url.searchParams.has('token')) url.searchParams.set('token', token)
    return { kind: 'bridge', url: url.toString() }
  }
  if (token !== undefined) return { kind: 'bridge', url: localMcpUrl() }
  return undefined
}

async function connectTarget(options: Options, runDir: string, projectPath: string): Promise<Connected> {
  if (options.target === 'bridge') {
    const session = await openBridgeSession({ logDir: runDir, headless: envValue('MCUT_HEADED') !== '1' })
    return { target: { kind: 'bridge', url: session.mcpUrl }, srcOf: servedSrc(session.mediaOrigin), session, close: session.close }
  }
  const external = externalBridge()
  if (external === undefined) {
    return { target: { kind: 'stdio', projectPath }, srcOf: repoRelativeSrc, session: undefined, close: async () => {} }
  }
  const fixtures = startFixtureServer()
  log(`serving fixtures for the external bridge from ${fixtures.origin}`)
  return { target: external, srcOf: servedSrc(fixtures.origin), session: undefined, close: fixtures.stop }
}

function xaiRunner(options: Options, session: McpSession): TaskRunner {
  if (options.dryRun) return (task) => runTask(task, session, createScriptedModel(task.scripted), options.caps)
  const apiKey = envValue('XAI_API_KEY')
  if (apiKey === undefined) {
    throw new ConfigError('XAI_API_KEY is not set. Export it, or pass --dry-run to replay the scripted tool calls.')
  }
  const xai = createXaiModel({
    apiKey,
    model: envValue('XAI_MODEL') ?? DEFAULT_XAI_MODEL,
    baseUrl: envValue('XAI_BASE_URL') ?? DEFAULT_XAI_BASE_URL,
    requestTimeoutMs: XAI_REQUEST_TIMEOUT_MS,
  })
  return (task) => runTask(task, session, xai, options.caps)
}

function listTasks(): void {
  for (const task of TASKS) {
    const fixtures = task.fixtures.map((fixture) => fixture.id).join(', ')
    console.log(`${task.id.padEnd(30)} ${task.target.padEnd(7)} ${task.title} [fixtures ${fixtures}]`)
  }
}

function selectTasks(tasks: E2ETask[], ids: string[], target: McpTarget): E2ETask[] {
  const chosen = ids.length === 0 ? tasks : tasks.filter((task) => ids.includes(task.id))
  return chosen.filter((task) => {
    if (task.target === 'any' || target.kind === 'bridge') return true
    log(`${task.id} skipped, it needs the live bridge (pass --target bridge)`)
    return false
  })
}

async function runAll(tasks: E2ETask[], runner: TaskRunner): Promise<TaskRun[]> {
  const runs: TaskRun[] = []
  for (const task of tasks) {
    log(`${task.id} (${task.title})`)
    const run = await runner(task)
    const status = run.verdict.pass ? 'PASS' : 'FAIL'
    log(`${task.id} ${status} with ${run.model} in ${run.steps} steps, ${run.toolCalls.length} tool calls, ${run.durationMs} ms`)
    for (const reason of run.verdict.reasons) log(`  ${reason}`)
    runs.push(run)
  }
  return runs
}

function finishReport(runs: TaskRun[], target: McpTarget, options: Options, runDir: string): number {
  const model = runs[0]?.model ?? 'none'
  const report = buildReport(runs, model, describeTarget(target), options.dryRun)
  const file = writeReport(report, runDir)
  log(`report written to ${file}`)
  console.log(markdownTable(report))
  return report.failed === 0 ? 0 : EXIT_FAILED
}

async function runWithXai(options: Options, runDir: string, workDir: string): Promise<number> {
  const connected = await connectTarget(options, runDir, join(workDir, 'project.mcut.json'))
  try {
    log(`connecting to ${describeTarget(connected.target)}`)
    const session = await connectMcp(createTransport(connected.target))
    try {
      const tasks = selectTasks(createTasks(connected.srcOf), options.taskIds, connected.target)
      const runs = await runAll(tasks, xaiRunner(options, session))
      return finishReport(runs, connected.target, options, runDir)
    } finally {
      await session.close()
    }
  } finally {
    await connected.close()
  }
}

async function runWithGrokBuild(options: Options, runDir: string, workDir: string): Promise<number> {
  const binary = findGrokBinary()
  if (binary === undefined) {
    console.log(GROK_SKIPPED)
    log(`install Grok Build with \`${GROK_INSTALL_COMMAND}\` or point GROK_BIN at the binary`)
    return options.dryRun ? 0 : EXIT_CONFIG
  }
  const connected = await connectTarget(options, runDir, join(workDir, 'project.mcut.json'))
  const session = connected.session
  if (session === undefined) throw new ConfigError('--driver grok-build needs the bridge session this run opens itself.')
  try {
    const projectDir = join(workDir, 'grok-project')
    const configFile = writeGrokProject(projectDir, session.mcpUrl)
    log(`grok ${binary} reads ${configFile} (server ${describeTarget(connected.target)})`)
    const handshake = await checkGrokHandshake({ binary, projectDir, runDir })
    log(`grok mcp doctor: ${handshake.detail}`)
    if (!handshake.healthy) {
      log('grok could not complete the MCP handshake with the bridge, see grok-mcp-doctor.json in the run dir')
      return EXIT_FAILED
    }
    if (options.dryRun) {
      console.log(`grok mcp doctor reports the bridge healthy (${handshake.detail}). Dry run complete, no task ran.`)
      return 0
    }
    const mcp = await connectMcp(createTransport(connected.target))
    try {
      const tasks = selectTasks(createTasks(connected.srcOf), options.taskIds, connected.target)
      const grok = { binary, projectDir, runDir, caps: options.caps, model: envValue('GROK_BUILD_MODEL'), log }
      const runs = await runAll(tasks, (task) => runGrokBuildTask(task, mcp, grok))
      return finishReport(runs, connected.target, options, runDir)
    } finally {
      await mcp.close()
    }
  } finally {
    await connected.close()
  }
}

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv)
  if (options.list) {
    listTasks()
    return 0
  }
  const label = [options.target, ...(options.driver === 'grok-build' ? ['grok-build'] : []), ...(options.dryRun ? ['dry-run'] : [])]
  const runDir = createRunDir(label.join('-'))
  const workDir = mkdtempSync(join(tmpdir(), 'mcut-agent-e2e-'))
  try {
    if (options.driver === 'grok-build') return await runWithGrokBuild(options, runDir, workDir)
    return await runWithXai(options, runDir, workDir)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      log(message)
      if (error instanceof ConfigError) console.error(`\n${USAGE}`)
      const config = error instanceof ConfigError || error instanceof GrokBuildAuthError
      process.exit(config ? EXIT_CONFIG : EXIT_FAILED)
    })
}
