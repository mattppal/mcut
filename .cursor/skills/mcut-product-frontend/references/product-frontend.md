# Product frontend

## What the registry is

`apps/studio/registry/mcut/` is a shadcn-style code registry. Files there
power the in-repo editor at `/editor` and are installed verbatim into
end-user apps through `shadcn add`. Registry files must work outside this
repo. Do not depend on private app modules, private app routes, or
undocumented package internals.

## Import rules

Inside `apps/studio/registry/mcut/*`:

- Sibling registry files use relative imports such as `./editor-ui`.
- UI primitives use `@/components/ui/*`.
- Engine and runtime logic use public `@mcut/*` package imports.
- Do not import deep app paths such as `@/app/**`.
- Do not use Next.js-only APIs in portable registry components.

Add a new registry file to `apps/studio/registry.json` with its file entry,
dependencies, and registry dependencies.

## Product design language

Build the editor like CapCut or Premiere, not like a dashboard.

- Dark panel chrome.
- Dense but readable controls.
- Clear selection, drag, disabled, loading, and empty states.
- Reused primitives instead of one-off panel implementations.
- Design tokens for color, typography, overlays, and clip-type styling.

`apps/studio/eslint.config.mjs` includes `mcut-ui/no-adhoc-classes` for
registry files. If it flags arbitrary classes such as raw colors or custom
font sizes, look for an existing token before disabling the rule.

## Actions over handlers

Register new user-visible commands in `action-registry.ts` and
`editor-default-actions.ts`.

- Use ids like `category.verb`.
- Add labels, categories, shortcuts, and palette inclusion there.
- Delegate to a public editor operator when one exists.
- Write a custom `run` function only for UI-only behavior such as opening a
  panel or changing timeline zoom.

Registering there keeps hotkeys, the command palette, menus, and the
shortcuts dialog aligned.

## UI state and persistence

- UI state such as panel visibility and timeline zoom lives in
  `editor-ui.tsx`.
- Project, selection, and playback state flow through public `@mcut/react`
  hooks and engine dispatch or operator APIs.
- Persistence in `persistence.ts` stores project and assets. Do not persist
  ephemeral UI state unless the product requirement calls for it.

## Debugging product bugs

1. Reproduce the exact user journey in `/editor`.
2. Check whether the action exists in the palette, menus, and the shortcuts
   dialog.
3. Check selection, focus, disabled reasons, loading, empty states, and drag
   feedback.
4. If the project state is correct but the workflow is hidden, solve it as
   product UX first.

## Verification checklist

- Imports follow the registry rules.
- New registry files have an entry in `apps/studio/registry.json`.
- Run `bun run build` in `apps/studio` after registry edits.
- `bun run typecheck` and `bun run lint` in `apps/studio` pass.
- User-visible editor behavior has focused unit coverage or an e2e path.
- The change does not move reusable engine behavior into the app.
