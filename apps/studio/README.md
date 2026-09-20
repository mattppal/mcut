# mcut Studio app

This workspace is the Studio renderer, a static Next export that the Electron
shell in `apps/desktop` serves from `app://studio`, and the source for the
shadcn registry at `apps/studio/registry/mcut/`. The docs site copies
`public/r` at build time and serves it at `https://mcut.com/r`.

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
bun dev
```

`bun dev` starts `next dev` on port `3000` and opens the Electron app on it. The
app hosts the bridge on port `44737`, with editor sync at `/mcut-mcp` and
Streamable HTTP MCP at `/mcp`, and prints its `MCP_URL` line. Point any MCP
client that supports Streamable HTTP at that URL, or use Add to Cursor from the
app's MCP menu.

To work in a browser tab instead, run `bun run scripts/mcut-local-dev.ts bridge`
and `bun run --cwd apps/studio dev` in two terminals, then open the URL from
`bun run scripts/mcut-local-dev.ts url`.

Studio checks:

```sh
bun run --filter=mcut-studio typecheck
bun run --filter=mcut-studio test
```
