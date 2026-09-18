import { checkProjectInvariants, type Violation } from '../../../timeline/src/fuzz/invariants'
import { isRecord } from '../../../timeline/src/fuzz/json-schema-gen'
import { matchKnownFailure, type KnownFailure } from '../../../timeline/src/fuzz/known-failures'
import { resolveArgs, type Plan } from '../../../timeline/src/fuzz/plan'
import type { Project } from '../../../timeline/src/model'
import { MCP_SERVER_STATIC_TOOLS } from '../contract'
import type { McpFuzzServer, ProjectSnapshot, ToolReply } from './stdio-harness'

export type ToolFamily = 'command' | 'operator' | 'static'
export type Outcome = 'ok' | 'typed-error' | 'untyped-error'
export type Tally = Record<Outcome, number>
export type FamilyTallies = Record<ToolFamily, Tally>

export interface McpRunFailure {
  stepIndex: number
  tool: string
  args: unknown
  violations: Violation[]
}

export interface McpRunResult {
  byFamily: FamilyTallies
  untypedByStaticTool: Map<string, number>
  knownFailures: Map<string, number>
  failure?: McpRunFailure
}

export interface McpRunOptions {
  known?: readonly KnownFailure[]
}

interface Quarantined {
  issue: string
  violations: Violation[]
}

const TYPED_ERROR = /^(CommandError|ProjectFormatError|OperatorError) \([a-z-]+\): /
const FAMILIES: readonly ToolFamily[] = ['command', 'operator', 'static']
const OUTCOMES: readonly Outcome[] = ['ok', 'typed-error', 'untyped-error']
const staticTools: ReadonlySet<string> = new Set(MCP_SERVER_STATIC_TOOLS.map((tool) => tool.name))
const redoTools: ReadonlySet<string> = new Set(['redo', 'operator_edit_redo'])

export function toolFamily(name: string): ToolFamily {
  if (staticTools.has(name)) return 'static'
  return name.startsWith('operator_') ? 'operator' : 'command'
}

export function classifyReply(reply: ToolReply): Outcome {
  if (!reply.isError) return 'ok'
  return TYPED_ERROR.test(reply.text) ? 'typed-error' : 'untyped-error'
}

export function emptyTallies(): FamilyTallies {
  const tally = (): Tally => ({ ok: 0, 'typed-error': 0, 'untyped-error': 0 })
  return { command: tally(), operator: tally(), static: tally() }
}

export function addTallies(into: FamilyTallies, from: FamilyTallies): void {
  for (const family of FAMILIES) {
    for (const outcome of OUTCOMES) into[family][outcome] += from[family][outcome]
  }
}

export async function runMcpPlan(plan: Plan, server: McpFuzzServer, options: McpRunOptions = {}): Promise<McpRunResult> {
  const known = options.known ?? []
  const result: McpRunResult = { byFamily: emptyTallies(), untypedByStaticTool: new Map(), knownFailures: new Map() }
  const initial = await server.project()
  if (initial.kind !== 'parsed') throw new Error(`a fresh server project does not parse (${initial.message.slice(0, 300)})`)
  let before: Project = initial.project
  let quarantined: Quarantined | undefined

  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

  async function runStep(tool: string, args: unknown): Promise<Violation[]> {
    const family = toolFamily(tool)
    const reply = await server.call(tool, args)
    const outcome = classifyReply(reply)
    result.byFamily[family][outcome]++
    if (outcome === 'untyped-error' && family === 'static') count(result.untypedByStaticTool, tool)
    const snapshot = await server.project()
    if (outcome !== 'ok') {
      if (snapshot.kind !== 'parsed' || !Bun.deepEquals(snapshot.project, before, true)) {
        return [{ invariant: 'rejected-unchanged', detail: `project changed after ${outcome} ${reply.text.slice(0, 200)}` }]
      }
      if (outcome === 'typed-error' || family === 'static') return []
      const untyped = [{ invariant: 'untyped-error', detail: reply.text.slice(0, 300) }]
      const issue = matchKnownFailure(tool, untyped, known)?.issue
      if (issue === undefined) return untyped
      count(result.knownFailures, issue)
      return []
    }
    const violations = inspect(snapshot)
    if (violations.length === 0) {
      if (snapshot.kind === 'parsed') before = snapshot.project
      return []
    }
    const issue = matchKnownFailure(tool, violations, known)?.issue ?? replayedIssue(tool, violations, quarantined)
    if (issue === undefined) return violations
    count(result.knownFailures, issue)
    quarantined = { issue, violations }
    await server.call('undo', {})
    const restored = await server.project()
    if (restored.kind === 'parsed' && Bun.deepEquals(restored.project, before, true)) return []
    return [
      {
        invariant: 'undo-restores',
        detail: `project after undoing the quarantined ${tool} (${issue}) differs from the project before it`,
      },
    ]
  }

  for (const [stepIndex, step] of plan.steps.entries()) {
    const args = resolveArgs(step.args, before)
    let violations: Violation[]
    try {
      violations = await runStep(step.tool, args)
    } catch (error) {
      violations = [{ invariant: 'server-crash', detail: `${describe(error)}\nserver stderr ends with ${server.stderrTail()}` }]
    }
    if (violations.length > 0) return { ...result, failure: { stepIndex, tool: step.tool, args, violations } }
  }
  return result
}

function inspect(snapshot: ProjectSnapshot): Violation[] {
  if (snapshot.kind === 'unparseable') {
    return [
      {
        invariant: 'round-trip',
        detail: `parseProject rejected the get_project document with ${snapshot.message.slice(0, 300)}`,
      },
    ]
  }
  const violations = checkProjectInvariants(snapshot.project)
  if (!Bun.deepEquals(snapshot.document, snapshot.project, true)) {
    violations.push({
      invariant: 'round-trip',
      detail: firstDifference(snapshot.document, snapshot.project, 'project') ?? 'get_project document and its parsed project differ',
    })
  }
  return violations
}

function replayedIssue(tool: string, violations: Violation[], quarantined: Quarantined | undefined): string | undefined {
  if (quarantined === undefined || !redoTools.has(tool)) return undefined
  return Bun.deepEquals(violations, quarantined.violations, true) ? quarantined.issue : undefined
}

function firstDifference(saved: unknown, parsed: unknown, path: string): string | undefined {
  if (Bun.deepEquals(saved, parsed, true)) return undefined
  if (Array.isArray(saved) && Array.isArray(parsed)) {
    for (let i = 0; i < Math.max(saved.length, parsed.length); i++) {
      const difference = firstDifference(saved[i], parsed[i], `${path}[${i}]`)
      if (difference !== undefined) return difference
    }
  } else if (isRecord(saved) && isRecord(parsed)) {
    for (const key of new Set([...Object.keys(saved), ...Object.keys(parsed)])) {
      const difference = firstDifference(saved[key], parsed[key], `${path}.${key}`)
      if (difference !== undefined) return difference
    }
  }
  return `at ${path} server sent ${show(saved)} which parses back as ${show(parsed)}`
}

function show(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name} (${error.message})` : String(error)
}

export function formatMcpFailure(plan: Plan, result: McpRunResult): string {
  const { failure } = result
  if (!failure) return `seed ${plan.seed} had no failure`
  const { command, operator } = result.byFamily
  return [
    `mcp fuzz seed ${plan.seed} failed at step ${failure.stepIndex} (${failure.tool}) after ` +
      `${command.ok + operator.ok} applied edits and ${command['typed-error'] + operator['typed-error']} typed rejections`,
    ...failure.violations.map((violation) => `  [${violation.invariant}] ${violation.detail}`),
    `minimized steps (${plan.steps.length})`,
    JSON.stringify(plan.steps, null, 2),
    'resolved arguments at the failing step',
    JSON.stringify({ tool: failure.tool, arguments: failure.args }, null, 2),
    `reproduce with MCUT_FUZZ_SEED=${plan.seed} bun test src/mcp-fuzz.test.ts`,
  ].join('\n')
}
