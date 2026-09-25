import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { parseProject, type Project } from '@mcut/timeline'
import { openBridgeSession } from './bridge-session'
import { CURSOR_INSTALL_COMMAND, CursorAgentAuthError, findCursorAgentBinary, runCursorAgentPrompt, writeCursorProject } from './cursor-agent'
import { runCheck } from './edit-checks'
import { describeChanges } from './edit-diff'
import { readEditReport, writeEditReport, type EditReport, type EditRow } from './edit-report'
import { classifyFailure, loadEditSpec, type EditStep } from './edit-spec'
import { GROK_INSTALL_COMMAND, GrokBuildAuthError, findGrokBinary, runGrokPrompt, writeGrokProject, type AgentTurn } from './grok-build'
import { DEFAULT_CAPS, type Caps } from './loop'
import { connectMcp, createTransport, type McpSession } from './mcp'
import { startMcpRecorder } from './mcp-recorder'
import type { Prompt } from './model'
import { createRunDir } from './report'
import { connectStudioPage, type StudioPage } from './studio-cdp'

const EXIT_FAILED = 1
const EXIT_CONFIG = 2
const DEV_DEBUG_PORT = 9333
const DEFAULT_GROK_MODEL = 'grok-4.7'
const SETTLE_MS = 1_500

const USAGE = [
  'usage: bun scripts/agent-e2e/edit-eval.ts --edits <file.yaml|file.txt> [--media <dir>] [--driver grok-build|cursor-agent] [--app running|dev] [--max-steps N] [--wall-clock-ms N] [--only <edit id>]... [--report <file.md>]',
  '',
  'Runs each edit instruction as one headless agent prompt against Studio through the mcut MCP server,',
  'and writes one report row per edit to reports/agent-e2e/<stamp>-edit-eval/.',
  '',
  'app      running  the desktop app you already opened. MCUT_BRIDGE_URL is its Copy MCP URL value,',
  '                  MCUT_CDP_URL its --remote-debugging-port endpoint (default http://127.0.0.1:9222)',
  '         dev      launches apps/desktop from this checkout with remote debugging',
  '',
  `driver   grok-build    the default, needs XAI_API_KEY; model from GROK_BUILD_MODEL, default ${DEFAULT_GROK_MODEL}`,
  '         cursor-agent  needs `cursor-agent login` or CURSOR_API_KEY; model from CURSOR_AGENT_MODEL',
  '',
  'rescore  --rescore <run dir> --edits <file> re-runs the checks on the saved before and after JSON and rewrites the report',
  '',
  'Media is imported through the media bin file input, the files named under `place:` are put on the timeline.',
  'exit codes  0 every edit passed, 1 an edit failed, 2 configuration error',
].join('\n')

const SYSTEM = [
  'You are editing the video project open in mcut Studio through the mcut MCP server.',
  'Use only the mcut tools. Do not run shell commands, read or write files, or search the web.',
  'Inspect the project with get_summary or get_project when you need to. Finish the edit without asking questions.',
  'If part of the edit cannot be done with the available tools, do what you can and say plainly what is missing.',
].join(' ')

class ConfigError extends Error {}

type Driver = (id: string, prompt: Prompt) => Promise<AgentTurn>

interface Target {
  bridgeUrl: string
  cdpUrl: string
  label: string
  close(): Promise<void>
}

const log = (line: string): void => console.error(`[edit-eval] ${line}`)

const envValue = (name: string): string | undefined => {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

const positive = (raw: string | undefined, fallback: number, flag: string): number => {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${flag} must be a positive integer.`)
  return value
}

async function openTarget(app: string, runDir: string): Promise<Target> {
  if (app === 'running') {
    const bridgeUrl = envValue('MCUT_BRIDGE_URL')
    if (bridgeUrl === undefined) throw new ConfigError('--app running needs MCUT_BRIDGE_URL, the value MCP > Copy MCP URL puts on the clipboard.')
    return { bridgeUrl, cdpUrl: envValue('MCUT_CDP_URL') ?? 'http://127.0.0.1:9222', label: `running app ${new URL(bridgeUrl).origin}`, close: async () => {} }
  }
  if (app !== 'dev') throw new ConfigError(`--app must be running or dev, got "${app}".`)
  const session = await openBridgeSession({ logDir: runDir, remoteDebuggingPort: DEV_DEBUG_PORT })
  return { bridgeUrl: session.mcpUrl, cdpUrl: `http://127.0.0.1:${DEV_DEBUG_PORT}`, label: 'apps/desktop from this checkout', close: session.close }
}

function createDriver(name: string, projectDir: string, recorderUrl: string, runDir: string, caps: Caps): Driver {
  if (name === 'cursor-agent') {
    const binary = findCursorAgentBinary()
    if (binary === undefined) throw new ConfigError(`cursor-agent not found. Install it with \`${CURSOR_INSTALL_COMMAND}\` or set CURSOR_AGENT_BIN.`)
    log(`cursor-agent ${binary} reads ${writeCursorProject(projectDir, recorderUrl)}`)
    const options = { binary, projectDir, runDir, caps, model: envValue('CURSOR_AGENT_MODEL'), log }
    return (id, prompt) => runCursorAgentPrompt(id, prompt, options)
  }
  if (name === 'grok-build') {
    const binary = findGrokBinary()
    if (binary === undefined) throw new ConfigError(`grok not found. Install it with \`${GROK_INSTALL_COMMAND}\` or set GROK_BIN.`)
    log(`grok ${binary} reads ${writeGrokProject(projectDir, recorderUrl)}`)
    const options = { binary, projectDir, runDir, caps, model: envValue('GROK_BUILD_MODEL') ?? DEFAULT_GROK_MODEL, log }
    return (id, prompt) => runGrokPrompt(id, prompt, options)
  }
  throw new ConfigError(`--driver must be cursor-agent or grok-build, got "${name}".`)
}

function snapshot(runDir: string, file: string, project: Project): string {
  const path = join(runDir, file)
  writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
  return path
}

async function runStep(step: EditStep, context: { mcp: McpSession; page: StudioPage; driver: Driver; recorder: ReturnType<typeof startMcpRecorder>; runDir: string }): Promise<EditRow> {
  const { mcp, page, driver, recorder, runDir } = context
  const startedAt = Date.now()
  const before = await mcp.getProject()
  await page.drain()
  const mark = recorder.mark()
  const turn = await driver(step.id, { system: SYSTEM, user: step.ask })
  await Bun.sleep(SETTLE_MS)
  const after = await mcp.getProject()
  const toolCalls = recorder.since(mark)
  const signals = await page.drain()
  const screenshot = join(runDir, `${step.id}.png`)
  await page.screenshot(screenshot)
  const checks = step.checks.map((check) => runCheck(check, { before, after, calls: toolCalls }))
  const pass = turn.stop.stoppedBy === 'model' && checks.every((check) => check.pass)
  const finalMessage = turn.stop.stoppedBy === 'model' ? turn.stop.detail : `${turn.stop.stoppedBy}: ${turn.stop.detail}`
  return {
    id: step.id,
    asked: step.ask,
    capability: step.capability,
    note: step.note,
    driver: turn.model,
    toolCalls,
    toolErrors: toolCalls.filter((call) => call.isError).map((call) => `${call.name}: ${call.result.slice(0, 300)}`),
    toasts: signals.toasts,
    consoleErrors: signals.consoleErrors,
    changes: describeChanges(before, after),
    checks,
    pass,
    failure: pass ? null : classifyFailure(step, toolCalls, finalMessage),
    stoppedBy: turn.stop.stoppedBy,
    finalMessage,
    durationMs: Date.now() - startedAt,
    screenshot: basename(screenshot),
    beforeFile: basename(snapshot(runDir, `${step.id}.before.json`, before)),
    afterFile: basename(snapshot(runDir, `${step.id}.after.json`, after)),
  }
}

function rescore(runDir: string, steps: EditStep[]): number {
  const report = readEditReport(runDir)
  const load = (name: string): Project => parseProject(JSON.parse(readFileSync(join(runDir, name), 'utf8')))
  report.rows = report.rows.map((row) => {
    const step = steps.find((entry) => entry.id === row.id)
    if (step === undefined) return row
    const checks = step.checks.map((check) => runCheck(check, { before: load(row.beforeFile), after: load(row.afterFile), calls: row.toolCalls }))
    const pass = row.stoppedBy === 'model' && checks.every((check) => check.pass)
    log(`${row.id} ${row.pass === pass ? 'unchanged' : 'changed'}: ${pass ? 'PASS' : 'FAIL'} ${checks.map((check) => `${check.pass ? '+' : '-'}${check.check}`).join(', ')}`)
    return { ...row, checks, pass, failure: pass ? null : classifyFailure(step, row.toolCalls, row.finalMessage) }
  })
  log(`report ${writeEditReport(report, runDir).markdown}`)
  return report.rows.every((row) => row.pass) ? 0 : EXIT_FAILED
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      edits: { type: 'string' },
      media: { type: 'string' },
      driver: { type: 'string', default: 'grok-build' },
      rescore: { type: 'string' },
      app: { type: 'string', default: 'running' },
      'max-steps': { type: 'string' },
      'wall-clock-ms': { type: 'string' },
      report: { type: 'string' },
      only: { type: 'string', multiple: true, default: [] },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  if (values.edits === undefined) throw new ConfigError('--edits is required.')
  const spec = loadEditSpec(values.edits, values.media)
  const unknown = values.only.filter((id) => !spec.edits.some((step) => step.id === id))
  if (unknown.length > 0) throw new ConfigError(`--only names unknown edits ${unknown.join(', ')}. Known. ${spec.edits.map((step) => step.id).join(', ')}`)
  const steps = values.only.length === 0 ? spec.edits : spec.edits.filter((step) => values.only.includes(step.id))
  if (values.rescore !== undefined) return rescore(values.rescore, spec.edits)
  const caps: Caps = {
    maxSteps: positive(values['max-steps'], DEFAULT_CAPS.maxSteps * 2, '--max-steps'),
    wallClockMs: positive(values['wall-clock-ms'], DEFAULT_CAPS.wallClockMs * 2, '--wall-clock-ms'),
  }
  const runDir = createRunDir(`edit-eval-${values.driver}`)
  const target = await openTarget(values.app, runDir)
  const recorder = startMcpRecorder(target.bridgeUrl)
  const mcp = await connectMcp(createTransport({ kind: 'bridge', url: target.bridgeUrl }))
  const page = await connectStudioPage(target.cdpUrl)
  try {
    if (spec.media.length > 0) {
      log(`importing ${spec.media.map((path) => basename(path)).join(', ')} through the media bin`)
      await page.importFiles(spec.media)
    }
    for (const name of spec.place) await page.placeOnTimeline(name)
    await page.screenshot(join(runDir, '00-start.png'))
    const projectDir = mkdtempSync(join(tmpdir(), 'mcut-edit-eval-'))
    const driver = createDriver(values.driver, projectDir, recorder.url, runDir, caps)
    const report: EditReport = { generatedAt: new Date().toISOString(), driver: values.driver, app: target.label, media: spec.media.map((path) => basename(path)), rows: [] }
    let files = writeEditReport(report, runDir)
    for (const step of steps) {
      log(`${step.id}: ${step.ask}`)
      const row = await runStep(step, { mcp, page, driver, recorder, runDir })
      log(`${step.id} ${row.pass ? 'PASS' : `FAIL (${row.failure})`} ${row.toolCalls.length} tool calls, ${row.toolErrors.length} errors, ${row.durationMs} ms`)
      report.rows.push(row)
      report.driver = report.rows[0]?.driver ?? values.driver
      files = writeEditReport(report, runDir)
    }
    const { rows } = report
    log(`report ${files.markdown}`)
    if (values.report !== undefined) {
      mkdirSync(dirname(values.report), { recursive: true })
      copyFileSync(files.markdown, values.report)
      log(`copied to ${values.report} (screenshots stay in ${relative(dirname(values.report), runDir)})`)
    }
    return rows.every((row) => row.pass) ? 0 : EXIT_FAILED
  } finally {
    page.close()
    await mcp.close()
    await recorder.stop()
    await target.close()
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      log(error instanceof Error ? error.message : String(error))
      if (error instanceof ConfigError) console.error(`\n${USAGE}`)
      const config = error instanceof ConfigError || error instanceof CursorAgentAuthError || error instanceof GrokBuildAuthError
      process.exit(config ? EXIT_CONFIG : EXIT_FAILED)
    })
}
