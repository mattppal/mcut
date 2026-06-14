# Architecture Map

## Workspaces

The root `package.json` defines three Bun workspace groups:

- `packages/*` for published libraries and binaries.
- `examples/*` for runnable integration examples.
- `apps/*` for hosted app surfaces such as the web lander.

Turbo runs `build`, `typecheck`, `test`, `lint`, and `dev` across workspaces.

## Packages

| Package | Role | Depends on |
| --- | --- | --- |
| `@mcut/timeline` | Headless project model, command registry, `EditorEngine`, undo/redo, selectors, keyframes, animation presets, multicam helpers | `@tanstack/store`, `zod` |
| `@mcut/compositor` | Pure Canvas2D frame renderer, element and transition renderers, geometry, text layout | `@mcut/timeline`, `zod` |
| `@mcut/editor` | `EditorOperatorRegistry` and user-level operators over timeline commands | `@mcut/timeline`, `zod` |
| `@mcut/media` | Media probing, preview pools, filmstrips, audio peaks, browser-side export, container-format registry | `@mcut/timeline`, `@mcut/compositor`, `mediabunny` |
| `@mcut/react` | React 19 bindings: `EditorProvider`, hooks, `PlayerCanvas`, gestures | `@mcut/timeline`, `@mcut/compositor`, `@mcut/media`, `@tanstack/react-store` |
| `@mcut/transcription` | Provider interface, normalized transcripts, captions, SRT/VTT | `@mcut/timeline` |
| `@mcut/transcription-ai-sdk` | Transcription provider backed by the Vercel AI SDK | `@mcut/transcription` peer |
| `@mcut/transcription-assemblyai` | Transcription provider backed by AssemblyAI | `@mcut/transcription` peer |
| `@mcut/transcription-local` | On-device transcription provider | `@mcut/transcription` peer |
| `@mcut/cli` | `mcut` binary for scaffold, validate, summarize, batch edit, silence cuts, captions | `@mcut/timeline`, `@mcut/transcription`, `zod` |
| `@mcut/mcp-server` | MCP server exposing commands, operators, project summary, undo/redo, and live bridge tools | `@mcut/timeline`, `@mcut/editor`, `@mcut/transcription`, MCP SDK |

## Dependency Graph

Arrows mean "depends on".

```text
@mcut/react -> @mcut/media -> @mcut/compositor -> @mcut/timeline
     |                                                 ^
     +-----------------------------------------------  |
@mcut/editor -----------------------------------------+
@mcut/cli -> @mcut/transcription ---------------------+
@mcut/mcp-server -> @mcut/editor, @mcut/timeline, @mcut/transcription
transcription providers -> @mcut/transcription
examples/apps -> packages
```

Rules derived from the graph:

- `@mcut/timeline` is the bottom. It imports nothing from this repo.
- Pure packages have no React dependency and should avoid DOM/browser globals.
- `@mcut/react` is the only React package.
- Examples and apps consume packages; nothing consumes examples or apps.
- CLI and MCP are integration surfaces. Shared behavior belongs in
  `@mcut/timeline`, `@mcut/editor`, or `@mcut/transcription` first.

## Key Paths

Engine core:

- `packages/timeline/src/model.ts` - `Project`, `Track`, `TimelineElement`,
  `AssetRef`, and zod schemas.
- `packages/timeline/src/commands.ts` - every serializable project mutation.
- `packages/timeline/src/engine.ts` - `EditorEngine` dispatch, undo, redo,
  transactions, and stores.
- `packages/timeline/src/selectors.ts` - project queries and placement helpers.
- `packages/timeline/src/keyframes.ts` - interpolation and easing.

Operators:

- `packages/editor/src/operators.ts` - registry type and factory.
- `packages/editor/src/core-operators.ts` - core playback, selection, and edit
  operators.
- `packages/editor/src/timeline-operators.ts` - timeline-level operators such as
  insert, duplicate, split, and trimming.

Rendering and media:

- `packages/compositor/src/render-frame.ts` - pure render orchestration.
- `packages/compositor/src/renderers.ts` - element renderers.
- `packages/media/src/preview-pool.ts` - media preview state.
- `packages/media/src/export.ts` - browser-side export.
- `packages/media/src/container-formats.ts` - format registry.

Agent and developer surfaces:

- `packages/cli/src/cli.ts` - command-line entrypoint.
- `packages/mcp-server/src/server.ts` - MCP tools and server construction.
- `examples/headless-editing/index.ts` - direct `EditorEngine` usage.
- `examples/agentic-editing/index.ts` - AI SDK command tools.
- `examples/mcp-server/index.ts` - minimal MCP launcher.

## Engine Invariants

Reducers and tests should keep these true:

- All times are integer milliseconds.
- `startMs` and split positions are timeline-absolute. Keyframes, angle cuts, and
  local animation data are element-local.
- `trimStartMs` offsets into source media.
- Elements cannot overlap on the same track.
- Transitions live on the left clip of an exactly adjacent pair.
- `rippleDelete` closes gaps; `removeElement` leaves them.
- Commands carry IDs and serializable data only, never object refs or functions.
- ID namespaces are meaningful: elements `e-*`, tracks `t-*`, assets `a-*`,
  projects `p-*`, layouts `lay-*`.
