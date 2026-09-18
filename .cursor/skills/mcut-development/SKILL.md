---
name: mcut-development
description: Contribute to the mcut monorepo. Use when adding or changing mcut packages, commands, operators, CLI or MCP behavior, examples, tests, or public APIs. Covers the clean-room policy, changeset mechanics, and how to run one package's tests. The rules are in AGENTS.md. Not for editing videos with mcut.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# Developing in the mcut repo

`AGENTS.md` at the repository root states the layout, where new code goes, the
commands, and the rules with the checks that enforce them. Read it first. This
skill covers the workflow that `AGENTS.md` leaves out.

## Clean-room policy

mcut mirrors the package boundaries and concepts of prior art, notably Twick,
which is Sustainable-Use licensed. Copy no code, identifiers, or docs from it.
Do not port, paraphrase, or reference-implement from a license-incompatible
codebase. If you read such code recently, describe the behavior you want in an
issue instead of writing the patch.

## Changesets

Every change under `packages/*` needs a changeset in the same pull request.

```sh
bunx changeset
```

Pick `minor` for a new public capability and `patch` for a fix. Write the
summary for a consumer of the package. Say what changes for them, not what the
diff does. Do not edit package versions by hand. The release workflow bumps
versions from merged changesets. `docs/RELEASES.md` describes it.

## Run one package's tests

Root `bun test` runs through Turbo and builds dependencies first. For a faster
loop, run the owning package's tests directly.

```sh
cd packages/timeline && bun test
cd packages/editor && bun test src/timeline-operators.test.ts
```

A test in one package runs against the last build of the packages it imports.
Run `bun run build` after you edit a dependency, or keep `bun dev` running.

Tests sit beside the source as `*.test.ts`. A reducer change gets a test in
`packages/timeline`. An operator change gets one in `packages/editor`. CLI
behavior is tested in `packages/cli/src/*.test.ts` and MCP behavior in
`packages/mcp-server/src/*.test.ts`. A media or compositor test asserts
deterministic output without a downstream app.
