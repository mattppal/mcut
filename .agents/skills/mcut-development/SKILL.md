---
name: mcut-development
description: Develop and review changes in the mcut OSS package monorepo, including package boundaries, command/operator layering, tests, CI, changesets, and clean-room contribution rules. Use when adding or changing mcut packages, commands, operators, MCP/CLI behavior, examples, tests, or public APIs. Not for editing videos with mcut.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# Developing in the mcut repo

mcut is an Apache-2.0 OSS monorepo of publishable video-editing packages. The
important development habit is to place behavior in the lowest package that owns
it, keep package dependencies one-way, and verify changes the same way CI does.

Read this first, then use:

- [../mcut/SKILL.md](../mcut/SKILL.md) when the task is to explain what mcut is
  or help someone get started with the OSS packages rather than change the repo.
- [references/architecture.md](references/architecture.md) for the package map and
  dependency rules.
- [references/workflows.md](references/workflows.md) for build, test, CI, and
  release commands.
- [references/dev-recipes.md](references/dev-recipes.md) for common contribution
  paths.

## The core layering

Every reusable editor behavior should flow down this stack. Higher layers may use
lower layers; lower layers must not know about higher ones.

| Layer | Lives in | What it owns |
| --- | --- | --- |
| 1. Commands | `packages/timeline/src/commands.ts` | Serializable, zod-validated project mutations. The only way project state changes. |
| 2. Operators | `packages/editor/src/*` | User-level intents that compose commands and define `enabled?` preconditions. |
| 3. Agent and app surfaces | `packages/cli`, `packages/mcp-server`, examples, downstream apps | Tools, CLIs, demos, and integrations over commands/operators. |
| 4. React bindings | `packages/react` | Thin React 19 provider, hooks, and canvas bindings. Logic stays in pure packages. |

Before writing code, decide its layer:

- Could this run headlessly in Bun with no DOM? Put it in `@mcut/timeline`,
  `@mcut/editor`, `@mcut/compositor`, `@mcut/transcription`, or another pure
  package, not React.
- Does it mutate a project? It must be a command or compose existing commands
  through `EditorEngine.dispatch()` / `engine.transact()`.
- Is it only a transport or integration? Put it in `@mcut/cli`, `@mcut/mcp-server`,
  or an example, and keep engine behavior in the packages underneath.

## Hard boundaries

1. Package dependency direction is one-way. `timeline` is the bottom. `react` is
   the only React package. Examples consume packages; packages do not consume
   examples.
2. `@tanstack/store` is alpha and quarantined inside `@mcut/timeline` except for
   the React binding dependency on `@tanstack/react-store`. Everything else goes
   through `EditorEngine`.
3. All project mutations are commands. Commands are serializable, zod-validated,
   undoable, and enforce engine invariants such as no track overlaps,
   integer-millisecond times, and namespaced IDs.
4. Pure packages must stay free of React, DOM, and browser globals. `@mcut/media`
   exposes browser-only export paths, but package-level logic should still be
   reusable and framework-free.
5. Clean-room policy is strict. mcut may mirror concepts from prior art, notably
   Sustainable-Use licensed Twick, but must not copy code, identifiers, or docs.
6. Public API or behavior changes to published `@mcut/*` packages need a
   changeset in the same PR.

## Known traps

- Package exports resolve to `dist/`. If tests or examples disagree with source
  edits, rebuild first with `bun run build` or keep `bun dev` running.
- Root `bun test` runs through Turbo and depends on package builds. For fast
  iteration, run the owning package tests directly, then run the root checks before
  finishing.
- Engine bugs usually belong in `@mcut/timeline` reducers/selectors or
  `@mcut/editor` operators, even when they surface through CLI, MCP, React, or an
  example.
- CI runs `git diff --exit-code` after build/test/smoke checks. Generated or
  formatted outputs must be committed if a command legitimately changes them.

## Development loop

```sh
bun install
bun dev
bun run build
bun test
bun run typecheck
bun run smoke:packages
```

Narrow commands:

```sh
cd packages/timeline && bun test
cd packages/editor && bun test src/timeline-operators.test.ts
bun run lint
```

## Pre-PR checklist

- [ ] `bun run build && bun run typecheck && bun test && bun run smoke:packages`
      pass from the root.
- [ ] `git status --short` shows only intentional changes after the build.
- [ ] New or changed reducers/operators have colocated tests.
- [ ] Public package API or behavior changes include `bunx changeset`.
- [ ] No React, DOM, browser globals, or upward package imports were introduced
      into pure packages.
- [ ] Clean-room policy was followed: no copying or paraphrasing from
      license-incompatible codebases.
