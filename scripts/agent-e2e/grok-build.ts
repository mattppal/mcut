import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { tapLines } from './bridge-session'
import { jsonObjectSchema } from './json'
import { judge, prepareTask, transcriptText, type Caps, type Stop } from './loop'
import type { McpSession } from './mcp'
import type { E2ETask, TaskRun, ToolCall } from './types'

export const GROK_SERVER_NAME = 'mcut-live'

export const GROK_INSTALL_COMMAND = 'curl -fsSL https://x.ai/cli/install.sh | bash'

const TOOL_PREFIX = `${GROK_SERVER_NAME}__`
const DOCTOR_TIMEOUT_MS = 60_000
const STDERR_TAIL_LINES = 20
const AUTH_FAILURE = /not signed in|XAI_API_KEY|unauthorized|invalid api key|\b401\b/i

const GROK_RULES = [
  `The mcut tools are served by the MCP server named ${GROK_SERVER_NAME}; call them directly.`,
  'Do not run shell commands, read or write files, or search the web for this task.',
].join(' ')

export class GrokBuildError extends Error {}

export class GrokBuildAuthError extends GrokBuildError {}

export interface GrokBuildOptions {
  binary: string
  projectDir: string
  runDir: string
  caps: Caps
  model: string | undefined
  log: (line: string) => void
}

export interface GrokHandshake {
  healthy: boolean
  detail: string
}

const toolCallEvent = z.object({
  type: z.literal('tool_call'),
  toolCallId: z.string(),
  toolName: z.string().optional(),
  title: z.string().optional(),
  rawInput: z.unknown().optional(),
})

const toolUpdateEvent = z.object({
  type: z.literal('tool_call_update'),
  toolCallId: z.string(),
  status: z.string().nullable().optional(),
  content: z.array(z.object({ content: z.object({ text: z.string().optional() }).optional() })).default([]),
  rawOutput: z.unknown().optional(),
})

const useToolInput = z.object({ tool_name: z.string(), tool_input: jsonObjectSchema.default({}) })

const mcpOutput = z.object({ type: z.literal('MCP'), output: z.record(z.string(), z.unknown()) })

const textEvent = z.object({ type: z.literal('text'), data: z.string() })

const usageSchema = z.object({ input_tokens: z.number().default(0), output_tokens: z.number().default(0) })

const endEvent = z.object({
  type: z.literal('end'),
  stopReason: z.string(),
  num_turns: z.number().default(0),
  usage: usageSchema.default({ input_tokens: 0, output_tokens: 0 }),
  modelUsage: z.record(z.string(), z.unknown()).default({}),
})

const errorEvent = z.object({ type: z.literal('error'), message: z.string() })

const maxTurnsEvent = z.object({ type: z.literal('max_turns_reached') })

const eventSchema = z.discriminatedUnion('type', [toolCallEvent, toolUpdateEvent, textEvent, endEvent, errorEvent, maxTurnsEvent])

const doctorSchema = z.object({
  servers: z.array(
    z.object({
      name: z.string(),
      healthy: z.boolean(),
      checks: z.array(z.object({ label: z.string(), passed: z.boolean(), detail: z.string().optional() })).default([]),
    }),
  ),
})

type EndEvent = z.infer<typeof endEvent>

interface PendingCall {
  id: string
  record: ToolCall
  startedAt: number
  text: string
  done: boolean
}

interface Transcript {
  calls: PendingCall[]
  text: string[]
  end: EndEvent | undefined
  error: string | undefined
  maxTurns: boolean
}

export function findGrokBinary(): string | undefined {
  const explicit = process.env.GROK_BIN
  if (explicit !== undefined && explicit.length > 0) return existsSync(explicit) ? explicit : undefined
  const onPath = Bun.which('grok')
  if (onPath !== null) return onPath
  const installed = join(homedir(), '.grok/bin/grok')
  return existsSync(installed) ? installed : undefined
}

const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function writeGrokProject(dir: string, mcpUrl: string): string {
  const grokDir = join(dir, '.grok')
  mkdirSync(grokDir, { recursive: true })
  const file = join(grokDir, 'config.toml')
  const lines = [
    '# Written by scripts/agent-e2e/grok-build.ts for one bridge session. The token dies with the session.',
    `[mcp_servers.${GROK_SERVER_NAME}]`,
    `url = ${tomlString(mcpUrl)}`,
    'enabled = true',
    '',
  ]
  writeFileSync(file, lines.join('\n'), 'utf8')
  return file
}

export async function checkGrokHandshake(
  options: Pick<GrokBuildOptions, 'binary' | 'projectDir' | 'runDir'>,
): Promise<GrokHandshake> {
  const proc = Bun.spawn([options.binary, '--trust', 'mcp', 'doctor', GROK_SERVER_NAME, '--json'], {
    cwd: options.projectDir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: DOCTOR_TIMEOUT_MS,
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  writeFileSync(join(options.runDir, 'grok-mcp-doctor.json'), stdout, 'utf8')
  let document: unknown
  try {
    document = JSON.parse(stdout)
  } catch {
    return { healthy: false, detail: `grok mcp doctor printed no JSON (exit ${proc.exitCode}). ${stderr.trim()}` }
  }
  const parsed = doctorSchema.safeParse(document)
  const server = parsed.success ? parsed.data.servers.find((entry) => entry.name === GROK_SERVER_NAME) : undefined
  if (server === undefined) {
    return { healthy: false, detail: `grok mcp doctor did not report ${GROK_SERVER_NAME}. ${stdout.trim()}` }
  }
  const detail = server.checks
    .map((check) => `${check.label} ${check.passed ? 'ok' : 'failed'}${check.detail ? ` (${check.detail})` : ''}`)
    .join(', ')
  return { healthy: server.healthy, detail }
}

const toolName = (raw: string): string => (raw.startsWith(TOOL_PREFIX) ? raw.slice(TOOL_PREFIX.length) : raw)

function calledTool(event: z.infer<typeof toolCallEvent>): Pick<ToolCall, 'name' | 'args'> {
  const viaUseTool = event.toolName === 'use_tool' ? useToolInput.safeParse(event.rawInput) : undefined
  if (viaUseTool?.success) return { name: toolName(viaUseTool.data.tool_name), args: viaUseTool.data.tool_input }
  const args = jsonObjectSchema.safeParse(event.rawInput)
  return { name: toolName(event.toolName ?? event.title ?? 'unknown'), args: args.success ? args.data : {} }
}

function toolOutput(event: z.infer<typeof toolUpdateEvent>): { text: string; isError: boolean } | undefined {
  const mcp = mcpOutput.safeParse(event.rawOutput)
  if (mcp.success) {
    const [key, value] = Object.entries(mcp.data.output)[0] ?? ['', '']
    return { text: typeof value === 'string' ? value : JSON.stringify(value), isError: key !== 'OkayOutput' }
  }
  const text = event.content.map((part) => part.content?.text ?? '').join('')
  return text.length > 0 ? { text, isError: false } : undefined
}

function finish(call: PendingCall, isError: boolean): void {
  call.done = true
  call.record.isError = isError
  call.record.result = transcriptText(call.text)
  call.record.durationMs = Math.round(performance.now() - call.startedAt)
}

function observe(transcript: Transcript, event: z.infer<typeof eventSchema>): void {
  switch (event.type) {
    case 'tool_call':
      transcript.calls.push({
        id: event.toolCallId,
        record: { ...calledTool(event), result: '', isError: false, durationMs: 0 },
        startedAt: performance.now(),
        text: '',
        done: false,
      })
      break
    case 'tool_call_update': {
      const call = transcript.calls.find((entry) => entry.id === event.toolCallId)
      if (call === undefined || call.done) break
      const output = toolOutput(event)
      if (output !== undefined) call.text = output.text
      if (event.status === 'completed') finish(call, output?.isError ?? false)
      if (event.status === 'failed') finish(call, true)
      break
    }
    case 'text':
      transcript.text.push(event.data)
      break
    case 'end':
      transcript.end = event
      break
    case 'error':
      transcript.error = event.message
      break
    case 'max_turns_reached':
      transcript.maxTurns = true
      break
  }
}

function stopOf(transcript: Transcript, exit: { code: number | null; signal: string | null; timedOut: boolean; stderr: string[] }): Stop {
  if (transcript.error !== undefined) return { stoppedBy: 'error', detail: transcript.error }
  if (exit.timedOut) return { stoppedBy: 'wall-clock', detail: 'grok exceeded the wall clock cap and was killed' }
  const { end } = transcript
  if (end === undefined) {
    const how = exit.signal === null ? `code ${exit.code}` : `signal ${exit.signal}`
    return { stoppedBy: 'error', detail: `grok exited with ${how} before its end event.\n${exit.stderr.join('\n')}` }
  }
  if (end.stopReason === 'end_turn') return { stoppedBy: 'model', detail: transcript.text.join('') }
  if (transcript.maxTurns || end.stopReason.includes('turn')) {
    return { stoppedBy: 'step-cap', detail: `hit the ${end.num_turns} turn cap, grok stopped with ${end.stopReason}` }
  }
  return { stoppedBy: 'error', detail: `grok stopped with ${end.stopReason}` }
}

function grokArgs(options: GrokBuildOptions, promptFile: string, rules: string): string[] {
  const args = [
    options.binary,
    '--trust',
    '--no-auto-update',
    '--always-approve',
    '--disable-web-search',
    '--no-subagents',
    '--no-plan',
    '--verbatim',
    '--tools',
    'read_file',
    '--max-turns',
    String(options.caps.maxSteps),
    '--output-format',
    'streaming-json',
    '--rules',
    rules,
  ]
  if (options.model !== undefined) args.push('--model', options.model)
  args.push('--prompt-file', promptFile)
  return args
}

export async function runGrokBuildTask(task: E2ETask, session: McpSession, options: GrokBuildOptions): Promise<TaskRun> {
  const startedAt = Date.now()
  const prompt = await prepareTask(task, session)
  const promptFile = join(options.runDir, `${task.id}.prompt.md`)
  writeFileSync(promptFile, `${prompt.user}\n`, 'utf8')
  const events = createWriteStream(join(options.runDir, `${task.id}.grok.ndjson`))
  const transcript: Transcript = { calls: [], text: [], end: undefined, error: undefined, maxTurns: false }
  const stderr: string[] = []

  const proc = Bun.spawn(grokArgs(options, promptFile, `${prompt.system} ${GROK_RULES}`), {
    cwd: options.projectDir,
    env: process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: options.caps.wallClockMs,
    killSignal: 'SIGKILL',
  })
  options.log(`${task.id}: grok pid ${proc.pid} reading ${promptFile}`)
  const onStdout = (line: string): void => {
    events.write(`${line}\n`)
    if (line.trim().length === 0) return
    let document: unknown
    try {
      document = JSON.parse(line)
    } catch {
      return
    }
    const event = eventSchema.safeParse(document)
    if (event.success) observe(transcript, event.data)
  }
  const onStderr = (line: string): void => {
    stderr.push(line)
    if (stderr.length > STDERR_TAIL_LINES) stderr.shift()
  }
  await Promise.all([tapLines(proc.stdout, onStdout), tapLines(proc.stderr, onStderr), proc.exited])
  events.end()
  for (const call of transcript.calls) {
    if (!call.done) finish(call, true)
  }
  const timedOut = proc.signalCode === 'SIGKILL'
  const stop = stopOf(transcript, { code: proc.exitCode, signal: proc.signalCode, timedOut, stderr })
  if (stop.stoppedBy === 'error' && AUTH_FAILURE.test(stop.detail)) {
    throw new GrokBuildAuthError(`grok could not authenticate. ${stop.detail}`)
  }

  const toolCalls = transcript.calls.map((call) => call.record)
  const project = await session.getProject()
  const models = Object.keys(transcript.end?.modelUsage ?? {})
  return {
    task: { id: task.id, title: task.title, fixtures: task.fixtures },
    model: `grok-build/${models.length > 0 ? models.join('+') : (options.model ?? 'default')}`,
    toolCalls,
    steps: transcript.end?.num_turns ?? 0,
    durationMs: Date.now() - startedAt,
    tokens: { input: transcript.end?.usage.input_tokens ?? 0, output: transcript.end?.usage.output_tokens ?? 0 },
    verdict: judge(task, project, toolCalls, stop),
    stoppedBy: stop.stoppedBy,
    finalMessage: stop.stoppedBy === 'model' ? stop.detail : '',
  }
}
