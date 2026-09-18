import { knownFailures, type KnownFailure } from '../../../timeline/src/fuzz/known-failures'

export const mcpKnownFailures: readonly KnownFailure[] = [
  ...knownFailures,
  {
    issue: 'https://github.com/mattppal/mcut/issues/53',
    tools: ['operator_media_insertAssetAtPlayhead'],
    invariants: ['untyped-error'],
    detail: /^no asset "/,
  },
]
