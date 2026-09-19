import type { Violation } from "../../../../packages/media/src/fuzz/invariants";
import type { KnownFailure } from "../../../../packages/media/src/fuzz/known-failures";

export { matchKnownFailure } from "../../../../packages/media/src/fuzz/known-failures";
export type { KnownFailure, Violation };

const issues = "https://github.com/mattppal/mcut/issues";

export const knownFailures: readonly KnownFailure[] = [
  {
    issue: `${issues}/73`,
    fixtures: ["counter-vp9-webm.trunc50"],
    invariants: ["typed-rejection"],
    detail: /CommandError: invalid payload for "addAsset"/,
  },
];
