# Agent contract for mcut

mcut is an open source video editing SDK for TypeScript. The repository is a
Bun workspace. The published `@mcut/*` packages are under `packages/`. Studio,
the editor app, is at `apps/studio`. The docs site is at `apps/web`. The agent
editing skill is at `skills/mcut-editing`. This file is the agent contract for
the whole repository.

## Where the docs are

`apps/web/content/docs/` is the docs site. `concepts/` explains one mechanism
per page. `packages/` has one page per published package. `recipes/` gives the
steps for one task. `reference/` documents the CLI, the MCP server, the browser
bridge, commands, and operators. `sdk/` holds the API reference.
`contributing/` holds the contributor guide and the dev environment page.

`docs/` holds maintainer docs on publishing, releases, and the MCP relay.
`packages/*/README.md` gives each package's install command and entry points.

## Layout

Each package imports only from the layers below it. `@mcut/timeline` imports
nothing from this repository. `@mcut/react` is the only package that imports
React. Examples and apps consume packages. Nothing consumes an example or an
app.

| Layer | Package | Owns |
| --- | --- | --- |
| 1 | `@mcut/timeline` | Project model, zod-validated commands, `EditorEngine` with dispatch, undo, redo, and transactions, selectors, keyframes, migrations |
| 2 | `@mcut/editor` | Operators, the user-level intents that compose commands and define `enabled` preconditions |
| 2 | `@mcut/compositor` | Frame rendering, element and transition renderers, Canvas2D and WebGPU backends, hit testing, text layout |
| 2 | `@mcut/transcription` | Provider interface, normalized transcripts, captions, SRT and VTT |
| 3 | `@mcut/media` | Media probing, preview pools, filmstrips, audio peaks, browser export, container formats |
| 3 | `@mcut/transcription-local`, `@mcut/transcription-ai-sdk`, `@mcut/transcription-assemblyai` | One transcription provider each |
| 3 | `@mcut/cli`, `@mcut/mcp-server` | The `mcut` binary and the MCP server, both tools over commands and operators |
| 3 | `@mcut/desktop-ipc` | The typed IPC contract between the desktop main process and Studio. One zod schema table per channel, the `DesktopApi` the preload exposes, `readDesktopApi` |
| 4 | `@mcut/react` | `EditorProvider`, hooks, `PlayerCanvas`, gestures. Logic stays in the packages below |
| app | `apps/studio`, `apps/web`, `examples/*` | Studio, the docs site, and runnable integrations over the packages |
| app | `apps/desktop` | The Electron shell. Serves the Studio static export from `app://studio` and hosts `LiveMcutBridge` in the main process |

Every project mutation is a command in `@mcut/timeline`. A command is
serializable, validated by zod, and undoable. Operators and apps change project
state only through `engine.dispatch` and `engine.transact`.

Package `exports` resolve to `dist/`. Build before you test a consumer of a
package you edited. `bun run build` rebuilds every package. `bun dev` keeps
watch builds running.

## Placement

| You are adding | Put it at |
| --- | --- |
| A command | `packages/timeline/src/commands.ts`, through `defineCommand` with a zod schema |
| An operator | `packages/editor` |
| A renderer | `packages/compositor` |
| A media codec or container | `packages/media` |
| A React hook that touches the DOM or a subscription | `packages/react/src/sync/` |
| Studio UI | `apps/studio/registry/mcut` |
| Desktop main process code | `apps/desktop/src` |
| A docs page | `apps/web/content/docs` |

## Commands

Run from the repository root unless the line says otherwise.

- `bun install --frozen-lockfile` installs the way CI does.
- `bun run release:check` runs `build`, `typecheck`, `test`, `lint`,
  `smoke:packages`, and `package:lint`. CI runs it on every pull request, then
  `bun run knip` and `git diff --exit-code`.
- `bun run knip` fails on an unused file, export, or dependency.
- `bun run standards` measures coding-standard drift against `origin/main` and
  fails on growth. The script is `scripts/standards/measure.ts`.
- `bun run e2e` in `apps/studio` runs the Playwright suite. CI runs it nightly,
  not per pull request.
- `bunx changeset` adds a changeset. Every change under `packages/*` needs one
  in the same pull request.

## Rules and the checks that enforce them

A bare metric name in the Check column is a `bun run standards` metric.

| Rule | Check |
| --- | --- |
| Comments. The only admitted comment states a fact about something outside this repository and links its source with an https URL. No JSDoc. The contract goes on a docs page. | `bun run standards` counts `commentLines`. |
| Effects. Application code in Studio has no `useEffect`. Synchronization with the DOM or a subscription goes through hooks in `packages/react/src/sync/`. | `useEffect` count in `apps/studio`. |
| Boundaries. Data enters as `unknown` and one zod parse turns it into a named type. No `Record<string, unknown>` outside a parse module. No `as` on external data. | `recordUnknown`, `asCast`. |
| Types. Program-owned unions are closed. A switch over one ends in a `never` arm. No `!`, no `any`, no `@ts-expect-error`. | `nonNull`, `anyType`, `tsSuppress`, and `.cursor/rules/languages/typescript-exhaustive-switch.mdc`. |
| Failures. Every failure has an owner, which is a callback, a thrown error, or a typed result. No empty `catch`. No `console.*` in packages. | `consoleLog`, `emptyCatch`. |
| Tests. A test stays only if it fails when its subject breaks. No absence-only, mock-only, or constant-pin tests. | Review, and `.cursor/rules/languages/no-tests-for-config-values.mdc`. |
| Exports. An export merges with its first caller. | `bun run knip`. |
| Prose. No em or en dashes, no mid-sentence colons, sentence case headings. | `longDash`, `colonConnector`. |
| Size. Files stay under 400 lines. | `longFile`. |
| Generated output. `apps/studio/public/r`, `skills/mcut-editing/references`, and the Studio skill mirror at `apps/studio/public/.well-known/agent-skills` are committed and regenerated by the build. | `git diff --exit-code` in CI. |

## Review

Every pull request runs through a deslop pass and a comment pass before it
opens. For each Bugbot finding, fix it, dismiss it with a reason, or ask.
