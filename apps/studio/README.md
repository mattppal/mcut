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
bun run studio
bun run studio:typecheck
bun run studio:test
```

Open `http://localhost:3000` for the editor. Set `ASSEMBLYAI_API_KEY` to enable
the demo transcription API route.
