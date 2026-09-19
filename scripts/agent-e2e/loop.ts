import type { Project } from '@mcut/timeline'
import { describeFixture, resolveFixture } from './fixtures'
import { parseJsonObject } from './json'
import { resetProject, type McpSession } from './mcp'
import type { FunctionCall, FunctionOutput, ModelClient, Prompt, TokenUsage } from './model'
import type { E2ETask, StopReason, TaskRun, ToolCall, Verdict } from './types'

export interface Caps {
  maxSteps: number
  wallClockMs: number
}

export const DEFAULT_CAPS: Caps = { maxSteps: 24, wallClockMs: 180_000 }

const TRANSCRIPT_RESULT_CHARS = 2_000

const MODEL_RESULT_CHARS = 24_000

const SYSTEM_PROMPT = [
  'You are operating mcut, a programmatic video editor, through its MCP tools.',
  'Every tool is an editor command or operator that changes the project immediately.',
  'Complete the editing task with tool calls. Use get_summary or get_project to inspect state',
  'when you need to, but do not call them repeatedly if nothing changed.',
  'Times are integer milliseconds. Ids named in the task already exist unless told otherwise.',
  'When the task is complete, stop calling tools and answer with one sentence describing the edit.',
  'Do not ask questions and do not wait for confirmation.',
].join(' ')

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`

export const transcriptText = (text: string): string => truncate(text, TRANSCRIPT_RESULT_CHARS)

const addTokens = (total: TokenUsage, turn: TokenUsage): void => {
  total.input += turn.input
  total.output += turn.output
}

export function buildPrompt(task: E2ETask, summary: string): Prompt {
  const fixtures = task.fixtures.map((fixture) => describeFixture(resolveFixture(fixture.id), fixture.src))
  const user = [
    `Task. ${task.prompt}`,
    `Media fixtures (use each src value verbatim as the asset src).\n${fixtures.join('\n')}`,
    `Current project state.\n${summary}`,
  ].join('\n\n')
  return { system: SYSTEM_PROMPT, user }
}

interface Executed {
  record: ToolCall
  output: FunctionOutput
}

async function executeCall(session: McpSession, call: FunctionCall): Promise<Executed> {
  const startedAt = performance.now()
  const parsed = parseJsonObject(call.arguments.trim().length === 0 ? '{}' : call.arguments)
  const result = parsed.ok
    ? await session.callTool(call.name, parsed.value)
    : { text: `Invalid JSON arguments for ${call.name}. ${parsed.message}`, isError: true }
  const record: ToolCall = {
    name: call.name,
    args: parsed.ok ? parsed.value : {},
    result: transcriptText(result.text),
    isError: result.isError,
    durationMs: Math.round(performance.now() - startedAt),
  }
  const prefix = result.isError ? 'ERROR: ' : ''
  return { record, output: { callId: call.callId, output: truncate(`${prefix}${result.text}`, MODEL_RESULT_CHARS) } }
}

interface LoopState {
  toolCalls: ToolCall[]
  steps: number
  tokens: TokenUsage
}

export interface Stop {
  stoppedBy: StopReason
  detail: string
}

async function drive(
  session: McpSession,
  model: ModelClient,
  prompt: Prompt,
  caps: Caps,
  startedAt: number,
  state: LoopState,
): Promise<Stop> {
  let turn = await model.start(prompt, await session.listTools())
  addTokens(state.tokens, turn.tokens)
  while (turn.calls.length > 0) {
    if (state.steps >= caps.maxSteps) return { stoppedBy: 'step-cap', detail: `hit the ${caps.maxSteps} step cap` }
    if (Date.now() - startedAt >= caps.wallClockMs) {
      return { stoppedBy: 'wall-clock', detail: `hit the ${caps.wallClockMs} ms wall clock cap` }
    }
    state.steps += 1
    const outputs: FunctionOutput[] = []
    for (const call of turn.calls) {
      const executed = await executeCall(session, call)
      state.toolCalls.push(executed.record)
      outputs.push(executed.output)
    }
    turn = await model.continue(outputs)
    addTokens(state.tokens, turn.tokens)
  }
  return { stoppedBy: 'model', detail: turn.text }
}

export function judge(task: E2ETask, project: Project, transcript: ToolCall[], stop: Stop): Verdict {
  const verdict = task.score(project, transcript)
  if (stop.stoppedBy === 'model') return verdict
  return { pass: false, reasons: [`run stopped early (${stop.stoppedBy}). ${stop.detail}`, ...verdict.reasons] }
}

export async function prepareTask(task: E2ETask, session: McpSession): Promise<Prompt> {
  await resetProject(session)
  for (const command of task.setup) await session.dispatch(command)
  const summary = await session.callTool('get_summary', {})
  return buildPrompt(task, summary.text)
}

export async function runTask(task: E2ETask, session: McpSession, model: ModelClient, caps: Caps): Promise<TaskRun> {
  const startedAt = Date.now()
  const prompt = await prepareTask(task, session)

  const state: LoopState = { toolCalls: [], steps: 0, tokens: { input: 0, output: 0 } }
  const stop = await drive(session, model, prompt, caps, startedAt, state).catch(
    (error: unknown): Stop => ({
      stoppedBy: 'error',
      detail: error instanceof Error ? error.message : String(error),
    }),
  )

  const project = await session.getProject()
  return {
    task: { id: task.id, title: task.title, fixtures: task.fixtures },
    model: model.model,
    toolCalls: state.toolCalls,
    steps: state.steps,
    durationMs: Date.now() - startedAt,
    tokens: state.tokens,
    verdict: judge(task, project, state.toolCalls, stop),
    stoppedBy: stop.stoppedBy,
    finalMessage: stop.stoppedBy === 'model' ? stop.detail : '',
  }
}
