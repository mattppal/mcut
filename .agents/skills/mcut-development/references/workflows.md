# Workflows

## Toolchain

- Package manager: Bun `1.3.14`, pinned by `packageManager`.
- Monorepo runner: Turbo.
- Package builds: `tsdown`, emitting `dist/index.js` and declarations.
- TypeScript: strict config from `tsconfig.base.json`.
- Versioning and publishing: Changesets.

## Dist Resolution

Published package `exports` point at `./dist/index.js`. Workspace symlinks resolve
to the package directory, but consumers import built output. After editing a
package, rebuild before testing a different package, example, CLI, or MCP consumer.

Use one of these loops:

```sh
bun dev
```

or:

```sh
bun run build
```

`bun dev` runs package watch builds. `bun run build` is the reliable verification
command because Turbo rebuilds dependencies before consumers.

## Commands

| Task | Command | Where |
| --- | --- | --- |
| Install | `bun install` | root |
| Install like CI | `bun install --frozen-lockfile` | root |
| Watch builds | `bun dev` | root |
| Full build | `bun run build` | root |
| Typecheck | `bun run typecheck` | root |
| Unit tests | `bun test` | root |
| Lint | `bun run lint` | root |
| Smoke package exports | `bun run smoke:packages` | root |
| One package's tests | `bun test` | package directory |
| One test file | `bun test src/commands.test.ts` | package directory |
| Changeset | `bunx changeset` | root |

## Tests

Bun's native runner is used for package tests. Tests are colocated with source as
`*.test.ts`.

Guidance:

- Reducer changes need tests in `packages/timeline`.
- Operator changes need tests in `packages/editor`.
- CLI behavior belongs in `packages/cli/src/*.test.ts`.
- MCP behavior belongs in `packages/mcp-server/src/*.test.ts`.
- Media/compositor changes should test deterministic behavior without depending on
  a downstream app.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

```sh
bun install --frozen-lockfile
bun run release:check
git diff --exit-code
```

`release:check` runs build, typecheck, tests, package smoke checks, and package
metadata/lint checks. The final diff check means any generated outputs or lockfile
changes caused by the verified commands must be intentional and committed.

## Changesets

Add a changeset when a PR changes public API or externally observable behavior of
a published `@mcut/*` package:

```sh
bunx changeset
```

Use `minor` for new public capabilities and `patch` for fixes. The summary should
explain why the change matters to consumers, not just restate the diff.

Do not hand-edit package versions. The release workflow handles version bumps from
changesets.

## Environment

Common optional variables:

- `AI_GATEWAY_API_KEY` for live runs of `examples/agentic-editing`.
- Provider-specific transcription keys when testing concrete transcription
  packages or examples.
