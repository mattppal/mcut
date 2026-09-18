import type { Violation } from './invariants'

export interface KnownFailure {
  issue: string
  tools: readonly string[]
  invariants: readonly string[]
  detail?: RegExp
}

const issues = 'https://github.com/mattppal/mcut/issues'
const splitters = ['addElement', 'splitElement', 'trimEdge', 'rippleTrim', 'rollEdit', 'slideElement']
const edgeTrims = ['trimEdge', 'rippleTrim', 'rollEdit', 'slideElement']

export const knownFailures: readonly KnownFailure[] = [
  { issue: `${issues}/43`, tools: splitters, invariants: ['round-trip'], detail: /"words",\s*\d+,\s*"endMs"/ },
  { issue: `${issues}/44`, tools: splitters, invariants: ['integer-ms', 'round-trip'], detail: /trimStartMs/ },
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
