import type { FuzzEntry } from './fixtures'
import { checkProbeInvariants, type Violation } from './invariants'
import { matchKnownFailure, type KnownFailure } from './known-failures'
import type { ProbeOutcome, ProbeRunner } from './probe-runner'

export interface ProbeFailure {
  entry: FuzzEntry
  outcome: ProbeOutcome
  violations: Violation[]
}

export interface ProbeFuzzResult {
  probed: number
  rejected: number
  knownFailures: Map<string, number>
  failure?: ProbeFailure
}

export interface ProbeFuzzOptions {
  known?: readonly KnownFailure[]
  onEntry?: (entry: FuzzEntry, outcome: ProbeOutcome, violations: readonly Violation[]) => void
}

export async function runProbeFuzz(entries: readonly FuzzEntry[], runner: ProbeRunner, options: ProbeFuzzOptions = {}): Promise<ProbeFuzzResult> {
  const known = options.known ?? []
  const knownFailures = new Map<string, number>()
  let probed = 0
  let rejected = 0
  for (const entry of entries) {
    const outcome = await runner.probe(entry.path)
    if (outcome.kind === 'probe') probed++
    if (outcome.kind === 'threw') rejected++
    const violations = checkProbeInvariants(entry, outcome, runner.timeoutMs)
    options.onEntry?.(entry, outcome, violations)
    if (violations.length === 0) continue
    const match = matchKnownFailure(entry.id, violations, known)
    if (!match) return { probed, rejected, knownFailures, failure: { entry, outcome, violations } }
    knownFailures.set(match.issue, (knownFailures.get(match.issue) ?? 0) + 1)
  }
  return { probed, rejected, knownFailures }
}

export function describeOutcome(outcome: ProbeOutcome): string {
  if (outcome.kind === 'probe') {
    const { probe } = outcome
    return `probe ${probe.durationMs}ms ${probe.width ?? '-'}x${probe.height ?? '-'} v=${probe.hasVideo} a=${probe.hasAudio}`
  }
  if (outcome.kind === 'threw') return `${outcome.typed ? 'rejected' : 'threw'} ${outcome.name}: ${outcome.message}`
  if (outcome.kind === 'hang') return `hang after ${outcome.elapsedMs}ms`
  return `crash ${outcome.message}`
}

export function formatFailure(failure: ProbeFailure): string {
  const { entry, outcome, violations } = failure
  const mutation = entry.kind === 'mutation' ? JSON.stringify(entry.mutation.mutation) : 'none'
  return [
    `media fuzz failed on ${entry.id} (${entry.path})`,
    `  mutation ${mutation}`,
    `  outcome ${describeOutcome(outcome)}`,
    ...violations.map((violation) => `  [${violation.invariant}] ${violation.detail}`),
    `reproduce with MCUT_FUZZ_FIXTURE=${entry.id} bun test src/media-fuzz.test.ts`,
  ].join('\n')
}
