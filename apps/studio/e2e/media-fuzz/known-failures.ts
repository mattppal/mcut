import type { Violation } from '../../../../packages/media/src/fuzz/invariants'
import type { KnownFailure } from '../../../../packages/media/src/fuzz/known-failures'

export { matchKnownFailure } from '../../../../packages/media/src/fuzz/known-failures'
export type { KnownFailure, Violation }

export const knownFailures: readonly KnownFailure[] = [];
