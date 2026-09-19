import type { BuiltinCommand } from '../commands'
import { EditorEngine } from '../engine'
import { CommandError } from '../errors'
import type { Project } from '../model'
import { checkProjectInvariants, type Violation } from './invariants'
import { isRecord } from './json-schema-gen'
import { matchKnownFailure, type KnownFailure } from './known-failures'
import { resolveArgs, type Plan } from './plan'

export interface RunFailure {
  stepIndex: number
  command: BuiltinCommand
  violations: Violation[]
}

export interface RunResult {
  applied: number
  rejected: number
  knownFailures: Map<string, number>
  failure?: RunFailure
}

export interface RunCommandOptions {
  engine?: EditorEngine
  known?: readonly KnownFailure[]
}

type Outcome =
  | { kind: 'applied'; project: Project }
  | { kind: 'rejected'; error: CommandError }
  | { kind: 'threw'; error: unknown }

export function runCommandPlan(plan: Plan, options: RunCommandOptions = {}): RunResult {
  const engine = options.engine ?? new EditorEngine()
  const known = options.known ?? []
  const knownFailures = new Map<string, number>()
  let applied = 0
  let rejected = 0
  for (const [stepIndex, step] of plan.steps.entries()) {
    const command = toCommand(step.tool, resolveArgs(step.args, engine.project))
    const before = engine.project
    const outcome = dispatch(engine, command)
    const fail = (violations: Violation[]): RunResult => ({
      applied,
      rejected,
      knownFailures,
      failure: { stepIndex, command, violations },
    })

    if (outcome.kind === 'threw') {
      return fail([{ invariant: 'uncaught-error', detail: describeThrown(outcome.error) }])
    }
    if (outcome.kind === 'rejected') {
      rejected++
      if (engine.project !== before) {
        return fail([
          {
            invariant: 'rejected-unchanged',
            detail: `project reference changed after CommandError ${outcome.error.code} (${outcome.error.message})`,
          },
        ])
      }
      continue
    }

    applied++
    const after = outcome.project
    const violations = checkProjectInvariants(after)
    if (after !== before) {
      engine.undo()
      if (!Bun.deepEquals(engine.project, before, true)) {
        violations.push({ invariant: 'undo-restores', detail: 'project after undo differs from the project before the command' })
      }
      engine.redo()
      if (!Bun.deepEquals(engine.project, after, true)) {
        violations.push({ invariant: 'redo-restores', detail: 'project after redo differs from the project the command produced' })
      }
    }
    if (violations.length === 0) continue
    const match = matchKnownFailure(step.tool, violations, known)
    if (!match) return fail(violations)
    knownFailures.set(match.issue, (knownFailures.get(match.issue) ?? 0) + 1)
    engine.undo()
  }
  return { applied, rejected, knownFailures }
}

export function formatFailure(plan: Plan, result: RunResult): string {
  const { failure } = result
  if (!failure) return `seed ${plan.seed}: no failure (applied ${result.applied}, rejected ${result.rejected})`
  return [
    `fuzz seed ${plan.seed} failed at step ${failure.stepIndex} (${failure.command.type}) ` +
      `after ${result.applied} applied and ${result.rejected} rejected commands`,
    ...failure.violations.map((violation) => `  [${violation.invariant}] ${violation.detail}`),
    `minimized steps (${plan.steps.length})`,
    JSON.stringify(plan.steps, null, 2),
    'resolved command at the failing step',
    JSON.stringify(failure.command, null, 2),
    `reproduce with MCUT_FUZZ_SEED=${plan.seed} bun test src/fuzz.test.ts`,
  ].join('\n')
}

function toCommand(type: string, args: unknown): BuiltinCommand {
  const payload = isRecord(args) ? args : {}
  // Fuzz steps are untrusted by design; applyCommand re-validates at the boundary.
  return { ...payload, type } as BuiltinCommand
}

function dispatch(engine: EditorEngine, command: BuiltinCommand): Outcome {
  try {
    return { kind: 'applied', project: engine.dispatch(command) }
  } catch (error) {
    return error instanceof CommandError ? { kind: 'rejected', error } : { kind: 'threw', error }
  }
}

function describeThrown(error: unknown): string {
  if (!(error instanceof Error)) return `threw a non-Error value ${String(error)}`
  const stackHead = (error.stack ?? '')
    .split('\n')
    .slice(1, 4)
    .map((line) => line.trim())
    .join(' | ')
  return `${error.name} (${error.message}) at ${stackHead}`
}
