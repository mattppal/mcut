import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { localMcpUrl } from '../mcut-local-dev'
import { DEFAULT_CAPS, runTask, type Caps } from './loop'
import { connectMcp, createTransport, describeTarget, type McpSession, type McpTarget } from './mcp'
import { createScriptedModel, type ModelClient } from './model'
import { buildReport, markdownTable, writeReport } from './report'
import { TASKS, findTask } from './tasks'
import type { E2ETask, TaskRun } from './types'
import { DEFAULT_XAI_BASE_URL, DEFAULT_XAI_MODEL, createXaiModel } from './xai'

const EXIT_FAILED = 1
const EXIT_CONFIG = 2
const XAI_REQUEST_TIMEOUT_MS = 120_000

const USAGE = [
  'usage: bun scripts/agent-e2e/run.ts [--dry-run] [--task <id>]... [--max-steps N] [--wall-clock-ms N] [--list]',
  '',
  'env  XAI_API_KEY        required unless --dry-run',
  `     XAI_MODEL          model id, default ${DEFAULT_XAI_MODEL}`,
  `     XAI_BASE_URL       API base, default ${DEFAULT_XAI_BASE_URL}`,
  '     MCUT_BRIDGE_URL    full MCP URL of a running live bridge (token included as ?token=)',
  '     MCUT_BRIDGE_TOKEN  pair with a local bridge on MCUT_BRIDGE_PORT (default 44737) instead',
  '',
  'exit codes  0 all tasks passed, 1 a task failed, 2 configuration error',
].join('\n')

class ConfigError extends Error {}

interface Options {
  dryRun: boolean
  list: boolean
  tasks: E2ETask[]
  caps: Caps
}

type ModelFactory = (task: E2ETask) => ModelClient

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

function selectTask(id: string): E2ETask {
  const task = findTask(id)
  if (task === undefined) {
    throw new ConfigError(`Unknown task "${id}". Known tasks. ${TASKS.map((entry) => entry.id).join(', ')}`)
  }
  return task
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      task: { type: 'string', multiple: true, default: [] },
      'max-steps': { type: 'string' },
      'wall-clock-ms': { type: 'string' },
    },
  })
  if (values.help) {
    console.log(USAGE)
    process.exit(0)
  }
  return {
    dryRun: values['dry-run'],
    list: values.list,
    tasks: values.task.length === 0 ? TASKS : values.task.map(selectTask),
    caps: {
      maxSteps: integer(values['max-steps'], DEFAULT_CAPS.maxSteps, '--max-steps'),
      wallClockMs: integer(values['wall-clock-ms'], DEFAULT_CAPS.wallClockMs, '--wall-clock-ms'),
    },
  }
}

function resolveTarget(projectPath: string): McpTarget {
  const explicit = envValue('MCUT_BRIDGE_URL')
  const token = envValue('MCUT_BRIDGE_TOKEN')
  if (explicit !== undefined) {
    const url = new URL(explicit)
    if (token !== undefined && !url.searchParams.has('token')) url.searchParams.set('token', token)
    return { kind: 'bridge', url: url.toString() }
  }
  if (token !== undefined) return { kind: 'bridge', url: localMcpUrl() }
  return { kind: 'stdio', projectPath }
}

function resolveModelFactory(dryRun: boolean): ModelFactory {
  if (dryRun) return (task) => createScriptedModel(task.scripted)
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
  return () => xai
}

function listTasks(): void {
  for (const task of TASKS) {
    console.log(`${task.id.padEnd(22)} ${task.title} [fixtures ${task.fixtures.join(', ')}]`)
  }
}

async function runAll(options: Options, session: McpSession, modelFor: ModelFactory): Promise<TaskRun[]> {
  const runs: TaskRun[] = []
  for (const task of options.tasks) {
    const model = modelFor(task)
    console.error(`[agent-e2e] ${task.id} (${task.title}) with ${model.model}`)
    const run = await runTask(task, session, model, options.caps)
    const status = run.verdict.pass ? 'PASS' : 'FAIL'
    console.error(`[agent-e2e] ${task.id} ${status} in ${run.steps} steps, ${run.toolCalls.length} tool calls`)
    for (const reason of run.verdict.reasons) console.error(`[agent-e2e]   ${reason}`)
    runs.push(run)
  }
  return runs
}

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv)
  if (options.list) {
    listTasks()
    return 0
  }
  const modelFor = resolveModelFactory(options.dryRun)
  const workDir = mkdtempSync(join(tmpdir(), 'mcut-agent-e2e-'))
  const target = resolveTarget(join(workDir, 'project.mcut.json'))
  console.error(`[agent-e2e] connecting to ${describeTarget(target)}`)
  const session = await connectMcp(createTransport(target))
  try {
    const runs = await runAll(options, session, modelFor)
    const model = runs[0]?.model ?? 'none'
    const report = buildReport(runs, model, describeTarget(target), options.dryRun)
    const file = writeReport(report)
    console.error(`[agent-e2e] report written to ${file}`)
    console.log(markdownTable(report))
    return report.failed === 0 ? 0 : EXIT_FAILED
  } finally {
    await session.close()
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[agent-e2e] ${message}`)
      if (error instanceof ConfigError) console.error(`\n${USAGE}`)
      process.exit(error instanceof ConfigError ? EXIT_CONFIG : EXIT_FAILED)
    })
}
