import type { Violation } from './invariants'

export interface KnownFailure {
  issue: string
  tools: readonly string[]
  invariants: readonly string[]
  detail?: RegExp
}

export const knownFailures: readonly KnownFailure[] = []

export function matchKnownFailure(
  tool: string,
  violations: readonly Violation[],
  known: readonly KnownFailure[] = knownFailures,
): KnownFailure | undefined {
  return known.find(
    (entry) =>
      entry.tools.includes(tool) &&
      violations.every((violation) => entry.invariants.includes(violation.invariant)) &&
      (entry.detail === undefined || violations.some((violation) => entry.detail?.test(violation.detail))),
  )
}
