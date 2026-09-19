---
name: base-ui
description: Work with Base UI primitives in Studio. Use when a change touches apps/studio/components/ui, adds a dialog, menu, popover, select, slider, or tooltip, or needs the Base UI API for a part, prop, or data attribute.
---

# Base UI in Studio

Studio's primitives are Base UI, not Radix. `apps/studio/package.json` pins `@base-ui/react` 1.5.0 and `shadcn` 4.10.0, and `apps/studio/components.json` uses the `base-rhea` style. `apps/web` pins the same Base UI version.

## Read the docs first

Fetch `https://base-ui.com/llms.txt` and follow the link for the component you touch. The Cursor cloud VM cannot reach `base-ui.com` (TLS fails at connect), so on a cloud agent read the installed types instead. `apps/studio/node_modules/@base-ui/react/<component>/index.parts.d.ts` lists every part, and `apps/studio/node_modules/@base-ui/react/<component>/<part>/<Component><Part>.d.ts` carries each prop with its documentation, for example `dialog/root/DialogRoot.d.ts`. `CHANGELOG.md` in the same package records breaking changes per version.

## Where the primitives live

Every Base UI import sits in one of the 20 wrappers under `apps/studio/components/ui/`. The editor code in `apps/studio/registry/mcut` imports the wrappers, never `@base-ui/react`. Keep it that way, so the primitive library stays swappable behind one folder.

| Wrapper | Base UI entry |
| --- | --- |
| `button.tsx` | `@base-ui/react/button`, `use-render`, `merge-props` |
| `collapsible.tsx` | `@base-ui/react/collapsible` |
| `context-menu.tsx` | `@base-ui/react/context-menu` |
| `dialog.tsx` | `@base-ui/react/dialog` |
| `dropdown-menu.tsx` | `@base-ui/react/menu` |
| `input.tsx`, `input-group.tsx` | `@base-ui/react/input` |
| `popover.tsx` | `@base-ui/react/popover` |
| `progress.tsx` | `@base-ui/react/progress` |
| `scroll-area.tsx` | `@base-ui/react/scroll-area` |
| `select.tsx` | `@base-ui/react/select` |
| `slider.tsx` | `@base-ui/react/slider` |
| `switch.tsx` | `@base-ui/react/switch` |
| `tooltip.tsx` | `@base-ui/react/tooltip` |

`command.tsx` is `cmdk`, `sonner.tsx` is Sonner, `resizable.tsx` is `react-resizable-panels`. `badge`, `kbd`, and `textarea` are plain Tailwind.

## Conventions the wrappers follow

- Every part forwards `data-slot="<component>-<part>"` so tests and styles target a stable hook.
- Open and close states style through Base UI data attributes, `data-open`, `data-closed`, `data-starting-style`, `data-ending-style`, and `data-[side=...]` for popups. Do not add JavaScript state for presence.
- Popups scale from `origin-(--transform-origin)`, which Base UI sets per side. Dialogs stay centered.
- Prop types come from the primitive, for example `DialogPrimitive.Root.Props`. Do not redeclare them.

## Adding a wrapper

Run `bunx shadcn add <component>` from `apps/studio` so the file follows the `base-rhea` style, then check `bun run lint` in `apps/studio`, which runs `shadcn registry validate`. A new wrapper needs no registry entry unless a `registry/mcut` component exports it.

## Review with the design skills

Motion and interaction detail on these wrappers goes through `review-animations` for a diff and `improve-animations` for a codebase audit. Both live beside this skill.
