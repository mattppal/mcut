import type { Violation } from './invariants'

export interface KnownFailure {
  issue: string
  fixtures: readonly string[]
  invariants: readonly string[]
  detail?: RegExp
}

export const knownFailures: readonly KnownFailure[] = []

export function matchKnownFailure(
  fixture: string,
  violations: readonly Violation[],
  known: readonly KnownFailure[] = knownFailures,
): KnownFailure | undefined {
  return known.find(
    (entry) =>
      entry.fixtures.includes(fixture) &&
      violations.every((violation) => entry.invariants.includes(violation.invariant)) &&
      (entry.detail === undefined || violations.some((violation) => entry.detail?.test(violation.detail))),
  )
}
