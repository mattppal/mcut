---
title: Contributing guide
description: Package boundaries, clean-room rules, tests, changesets, and pull request expectations.
---

## Start here

Read the repository `CONTRIBUTING.md` before opening a pull request. This page is
the docs-site version of the same operating model.

## Clean-room policy

mcut can mirror package boundaries and concepts from prior art, but contributors
must not copy code, identifiers, prose, tests, or documentation from
license-incompatible projects.

If you have recently read incompatible source code, describe the desired behavior
in an issue instead of writing the patch.

## Package boundaries

Keep changes in the package that owns the behavior:

- `@mcut/timeline`: project model, serializable commands, reducers, undo/redo, selectors.
- `@mcut/editor`: user-level operators and pure edit or gesture planning.
- `@mcut/compositor`: Canvas2D frame rendering and hit testing.
- `@mcut/media`: media probing, thumbnails, preview media, and browser WebCodecs export helpers.
- `@mcut/react`: React provider, hooks, and player canvas bindings.
- `@mcut/transcription*`: transcript provider interfaces, adapters, captions, SRT, and VTT.
- `@mcut/cli`: headless command-line workflows for project documents.
- `@mcut/mcp-server`: MCP tools and local browser bridge tooling.

Reusable edit behavior belongs in `@mcut/timeline` or `@mcut/editor`. React
bindings belong in `@mcut/react`. Product UI belongs in downstream apps.

## Commands and operators

Low-level project mutations should be zod-validated commands in
`@mcut/timeline`. User-facing edit intents should be operators in `@mcut/editor`
and should compose lower-level commands.

Agent and app surfaces should call those shared commands and operators instead
of inventing separate mutation paths.

## Tests

Add or update tests beside behavior changes. Reducer changes should test timeline
invariants such as integer-millisecond timing and no overlapping clips on the
same track.

Use package-local `bun test` while iterating, then run the root checks before
opening a pull request.

## Changesets

Add a Changesets entry when a public package API or package behavior changes:

```sh
bunx changeset
```

Documentation-only changes usually do not need a changeset.

## Pull requests

Keep pull requests scoped to one behavior or package boundary when practical.
Include the validation commands you ran in the pull request description.

Do not include generated `dist/` output.
