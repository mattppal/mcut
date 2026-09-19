import type { Violation } from './invariants'

export interface KnownFailure {
  issue: string
  tools: readonly string[]
  invariants: readonly string[]
  detail?: RegExp
}

const issues = 'https://github.com/mattppal/mcut/issues'
const edgeTrims = ['trimEdge', 'rippleTrim', 'rollEdit', 'slideElement']

export const knownFailures: readonly KnownFailure[] = [
  { issue: `${issues}/45`, tools: edgeTrims, invariants: ['round-trip'], detail: /too_big/ },
]

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
