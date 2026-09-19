import type { Violation } from './invariants'

export interface KnownFailure {
  issue: string
  fixtures: readonly string[]
  invariants: readonly string[]
  detail?: RegExp
}

const issues = 'https://github.com/mattppal/mcut/issues'
const truncatedMatroska = [
  'counter-vp9-webm.trunc50',
  'counter-vp9-mkv.trunc50',
  'counter-av1-mkv.trunc50',
  'odd-361x203-vp9-webm.trunc50',
  'gaps-opus-webm.trunc50',
  'tiny-1x1-vp9-webm.trunc50',
]

export const knownFailures: readonly KnownFailure[] = [
  { issue: `${issues}/72`, fixtures: truncatedMatroska, invariants: ['truncated-duration-positive'] },
]

export function matchKnownFailure(fixture: string, violations: readonly Violation[], known: readonly KnownFailure[] = knownFailures): KnownFailure | undefined {
  return known.find(
    (entry) =>
      entry.fixtures.includes(fixture) &&
      violations.every((violation) => entry.invariants.includes(violation.invariant)) &&
      (entry.detail === undefined || violations.some((violation) => entry.detail?.test(violation.detail))),
  )
}
