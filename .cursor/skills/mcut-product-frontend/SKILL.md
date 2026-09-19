---
name: mcut-product-frontend
description: Build and debug the Studio product UI and shadcn registry in apps/studio. Use when changing apps/studio routes, registry/mcut components, editor actions, product UX, frontend bugs, or interaction polish around the workspace @mcut packages.
---

# mcut product frontend

Use this skill for product and frontend work in `apps/studio`.
Studio consumes the workspace packages.

## First principles

- `apps/studio` owns the product UI, Next.js routes, API route wiring,
  persistence, registry composition, product workflows, and integration with
  the workspace `@mcut/*` packages.
- If the behavior can run headless in Bun with no React, DOM, or browser
  globals, put it in a workspace package, not in `apps/studio`.
- The shadcn registry at `apps/studio/registry/mcut/` powers the in-repo
  editor and installs into user apps through `shadcn add`.

## Frontend layering

| Need | Place |
| --- | --- |
| Hotkey, command palette, menu, shortcut dialog entry | `apps/studio/registry/mcut/editor-default-actions.ts` |
| Shared action metadata | `apps/studio/registry/mcut/action-registry.ts` |
| Editor panels, gestures, timeline UI, inspector UI | `apps/studio/registry/mcut/*.tsx` |
| Open panels, timeline zoom, local UI state | `apps/studio/registry/mcut/editor-ui.tsx` |
| App page or Studio shell wiring | `apps/studio/app/**` |
| UI primitive or product chrome | `apps/studio/components/ui/` or existing registry primitives |

Register actions instead of writing one-off handlers. Hotkeys, the command
palette, context menus, and the shortcuts dialog derive from the action
registry.

## Registry contract

Inside `apps/studio/registry/mcut/*`:

- Import sibling registry files with relative paths.
- Import shadcn primitives from `@/components/ui/*`.
- Import engine and runtime code from public `@mcut/*`.
- Do not import deep app paths such as `@/app/**`.
- Do not use Next.js-only APIs in components that ship through `shadcn add`.

After you edit registry files, run `bun run build` in `apps/studio`. That
command runs `shadcn build` and regenerates `public/r`.

## Product UX debugging

Reproduce the user's path in the running editor before changing engine-facing
code. Many editor bugs are missing empty states, unclear selection, invisible
disabled states, hidden palette actions, or weak timeline hints.

If the engine result is correct but users cannot discover the path, fix the
UI. Add hint text, an empty state, a cursor change, a disabled reason, a menu
item, a palette action, or visible selection feedback.

## Design and polish

- Reuse `Spinner`, `EmptyState`, and panel chrome from `editor-primitives.tsx`
  before creating new local patterns.
- Use design tokens. Avoid arbitrary font sizes, raw palette classes, and
  one-off colors in registry UI.
- Keep the editor dense and scan-friendly.
- Fit text in toolbars, panels, buttons, and timeline chips at mobile and
  desktop widths. Give repeated controls stable dimensions.

See [references/product-frontend.md](references/product-frontend.md) for the
registry import rules, action guidance, UI conventions, and verification
checklist.

## Verification

Use the narrowest check that proves the change.

```sh
bun run typecheck
cd apps/studio && bun test registry/mcut
cd apps/studio && bun run lint
cd apps/studio && bun run build
cd apps/studio && bun run e2e
```
