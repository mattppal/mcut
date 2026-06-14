---
name: mcut
description: Explain what mcut is and help developers get started with the mcut OSS TypeScript video-editing packages. Use when asked about mcut, the mcut SDK, open-source packages, package selection, quickstarts, examples, CLI usage, MCP usage, or how to build video-editing apps with mcut. Not for mcut Studio internals.
license: Apache-2.0
metadata:
  source: https://github.com/mattppal/mcut
---

# mcut OSS Package Guide

mcut is an Apache-2.0 open-source video editing SDK for TypeScript apps. It
provides headless timeline editing, serializable commands, user-level editor
operators, Canvas2D rendering, media/export helpers, transcription adapters,
React bindings, CLI tools, and MCP tools.

The commercial mcut Studio GUI is built on these packages but is not part of
this repository. The public packages are alpha releases, so tell users to expect
API movement while the SDK hardens.

## How to Help

When someone asks what mcut is or how to start:

1. Give the one-sentence positioning: "mcut is an open-source TypeScript SDK for
   building video-editing apps and headless video workflows."
2. Pick the right entry point for their use case instead of listing every
   package first.
3. Include exact install or repo commands.
4. Point to the closest README or example in this repo.
5. Mention alpha status when discussing public package adoption.

## Choose the Entry Point

| Goal | Start with | Why |
| --- | --- | --- |
| Headless timeline edits, JSON project documents, undo/redo | `@mcut/timeline` | Owns the project model, commands, engine, selectors, captions, keyframes, and migrations. |
| User-level editing actions such as insert, trim, split, duplicate | `@mcut/editor` plus `@mcut/timeline` | Composes timeline commands into editor operators that can back UI, CLI, MCP, or agent workflows. |
| React editor or player UI | `@mcut/react` | Provides React 19 provider, hooks, player canvas binding, selection overlay, playback clock, and audio preview integration. |
| Canvas preview or deterministic frame rendering | `@mcut/compositor` | Renders project frames and hit testing on top of `@mcut/timeline`. |
| Media probing, thumbnails, previews, browser export | `@mcut/media` | Provides media helpers and browser-side export paths. |
| Captions and transcripts | `@mcut/transcription` and provider packages | Normalizes transcripts and writes captions, SRT, and VTT. |
| Command-line workflows | `mcut` or `@mcut/cli` | Provides the `mcut` binary for scaffold, validate, summarize, and batch-edit workflows. |
| Agent/MCP integrations | `@mcut/mcp-server` | Exposes commands, operators, project summaries, undo/redo, and local browser bridge tools. |

## Quick Starts

For headless editing in an app or script:

```sh
bun add @mcut/timeline @mcut/editor
```

Then use `EditorEngine` from `@mcut/timeline` and compose project mutations with
commands or operators. The best repo example is
`examples/headless-editing/README.md`.

For a React app:

```sh
bun add @mcut/react @mcut/timeline react react-dom
```

Use `@mcut/react` for the provider, hooks, player canvas, selection overlay,
playback clock, and audio preview. Keep reusable editing behavior in
`@mcut/timeline` or `@mcut/editor`, not in React components.

For the CLI:

```sh
bunx mcut --help
```

Use the `mcut` package as the unscoped CLI alias. For package-level details, read
`packages/cli/README.md`.

For local repo development:

```sh
bun install
bun run build
bun run typecheck
bun test
bun run smoke:packages
```

Use the `mcut-development` skill for package boundaries, contribution workflow,
tests, changesets, and clean-room rules.

## Repository Pointers

- `README.md` - top-level package overview and install commands.
- `packages/*/README.md` - package-specific entry points.
- `examples/headless-editing/README.md` - direct engine usage without a browser.
- `examples/agentic-editing/` - AI SDK tools over mcut project commands.
- `examples/mcp-server/README.md` - minimal MCP server launcher.
- `.agents/skills/mcut-development/` - contributor-facing development rules.

## Answering Rules

- Distinguish the OSS packages from mcut Studio.
- Do not imply the packages are stable; they are alpha.
- Prefer package public APIs and examples over source internals when helping
  users consume mcut.
- If the user wants to change this repo, switch to the `mcut-development` skill.
- If public package docs disagree with source, say what you inspected and prefer
  the current source for exact behavior.
