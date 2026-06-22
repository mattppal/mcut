# mcut Studio app

This workspace is the reference Next.js editor and the source for the hosted
shadcn registry at `apps/studio/registry/mcut/`.

## Boundary

`apps/studio` is not the SDK. It can depend on `@mcut/*` packages, but packages
must never import from the Studio app. Keep reusable editing behavior in
packages:

- `@mcut/timeline` for project data, selectors, serializable commands, undo/redo,
  and invariants.
- `@mcut/editor` for user-level operators and pure gesture/action planning.
- `@mcut/compositor`, `@mcut/media`, `@mcut/transcription`, and `@mcut/react` for
  their focused runtime surfaces.

Registry files should own UI composition: React components, DOM gestures,
layout math, hotkeys, menus, app-specific persistence, and API route wiring. If a
decision can run against a `Project` in Bun with no React or DOM, move it to a
package before wiring it here.

## Registry rules

Files in `registry/mcut/` are installed as source into user apps through shadcn.
Use sibling-relative imports inside the registry, `@/components/ui/*` for UI
primitives, and public `@mcut/*` imports for SDK code. Do not import deep paths
from this app or rely on private package internals.

After changing registry files, run:

```sh
bunx shadcn build
```

## Development

From the repo root:

```sh
bun run setup
bun run dev
```

Local defaults are Studio on `http://localhost:3000` and the bridge on port
`44737`. The bridge exposes browser sync at `/mcut-mcp` and MCP over HTTP at
`/mcp`. In Conductor, Studio uses `CONDUCTOR_PORT` and the bridge uses
`CONDUCTOR_PORT + 1`. Open the connected editor URL printed by `bun run dev`, or
print it again with:

```sh
bun run scripts/mcut-local-dev.ts url
```

Then enable the `mcut-live` MCP server in Codex. Codex connects to the HTTP MCP
endpoint on the bridge that `bun run dev` already started.

Studio checks:

```sh
bun run --filter=mcut-studio-web typecheck
bun run --filter=mcut-studio-web test
```
