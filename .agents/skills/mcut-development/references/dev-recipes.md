# Dev Recipes

## Add or Change an Engine Command

1. Edit `packages/timeline/src/commands.ts`.
2. Keep input serializable: IDs, numbers, strings, booleans, arrays, and plain
   objects only.
3. Validate inputs with zod and enforce invariants in the reducer.
4. Add or update colocated tests, usually in `packages/timeline/src/commands.test.ts`
   or a focused `*.test.ts`.
5. Run package tests, then root verification.
6. Add a changeset if public behavior changed.

## Add or Change an Editor Operator

1. Edit the relevant file in `packages/editor/src/`.
2. Compose commands through `engine.dispatch()` or `engine.transact()`; do not
   mutate project objects directly.
3. Define `enabled?` when the operation has a precondition.
4. Register the operator with the core registry.
5. Add or update tests, commonly in `timeline-operators.test.ts` or
   `operators.test.ts`.
6. Add a changeset for `@mcut/editor` if public behavior changed.

## Add or Change CLI Behavior

1. Keep shared edit logic in packages below `@mcut/cli` first.
2. Wire parsing and command dispatch in `packages/cli/src/cli.ts` or a focused
   helper module.
3. Add tests in `packages/cli/src/*.test.ts`.
4. Run `cd packages/cli && bun test`, then root verification.
5. Add a changeset for `@mcut/cli` if the public CLI behavior changed.

## Add or Change MCP Behavior

1. Prefer exposing existing commands/operators from `@mcut/timeline` and
   `@mcut/editor`.
2. Put MCP-specific server or bridge behavior in `packages/mcp-server/src/`.
3. Keep schemas and returned summaries stable for agent clients.
4. Add tests in `packages/mcp-server/src/*.test.ts`.
5. Add a changeset for `@mcut/mcp-server` if public tool behavior changed.

## Add a New Package

Only add a package when the boundary is real. Otherwise extend an existing layer.

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`,
   `tsdown.config.ts`, and `src/index.ts` modeled on the closest package.
2. Respect the dependency graph. New packages should not make lower layers depend
   upward.
3. Include `build`, `dev`, `typecheck`, and relevant `test` scripts.
4. Add tests beside source.
5. Run root verification.
6. Add an initial changeset if it will be published.

## Fix an Engine Bug

1. Reproduce headlessly first with a failing test in the owning package.
2. Fix the lowest layer that owns the behavior.
3. Keep the regression test.
4. Rebuild before validating through CLI, MCP, React, or examples because consumers
   import `dist`.
5. Add a patch changeset for the affected package when user-visible behavior
   changes.

## Update Examples

1. Keep examples as consumers of public APIs.
2. Do not import package internals from `src/`.
3. Prefer concise examples that demonstrate one integration path.
4. Run the example's `start` or `typecheck` command if available, then root
   verification when the public API changes.

## Verify Like CI

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run test
bun run smoke:packages
git diff --exit-code
```
