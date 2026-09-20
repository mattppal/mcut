# mcut Publishing and Versioning

This repo contains the open source mcut SDK packages, docs site, Studio app, and
bundled editing skill.

## Package visibility

- Keep apps and bundled skills `private: true` unless they are intentionally
  published as standalone packages. They still use the repo's Apache-2.0
  license.
- Publish OSS packages from this repo under the `@mcut` npm scope.
- Do not publish the OSS packages privately first unless there is a temporary
  distribution need before the source repo, license, or package boundaries are
  ready.
- Public prereleases are the default while the API is unstable. Use alpha
  versions and the `alpha` npm dist-tag.

Every publishable package should include:

```json
{
  "publishConfig": {
    "access": "public"
  }
}
```

## Package map

- `@mcut/cli` is the published CLI package. Its binary is `mcut`, so use
  `bunx @mcut/cli` or `bunx -p @mcut/cli mcut`.
- `@mcut/timeline` owns the project model, commands, undo/redo, selectors, and
  migration helpers.
- `@mcut/editor` owns framework-independent user-level operators and edit
  planning.
- `@mcut/compositor` renders frames and hit testing.
- `@mcut/media` owns media probing, thumbnails, audio extraction, preview media,
  and browser WebCodecs export.
- `@mcut/react` provides React bindings, playback state, and player canvas
  integration.
- `@mcut/transcription` defines the provider interface, normalized transcript
  data, captions, SRT, and VTT helpers.
- `@mcut/transcription-ai-sdk`, `@mcut/transcription-assemblyai`, and
  `@mcut/transcription-local` are optional transcription providers.
- `@mcut/cli` provides headless project document editing commands.
- `@mcut/mcp-server` exposes commands and editor operators as MCP tools,
  including live browser bridge commands. Its binaries are `mcut-mcp`,
  `mcut-mcp-live`, and `mcut-bridge`.

## Versioning model

Use lockstep versions for core `@mcut/*` packages while the SDK is in alpha:

```txt
@mcut/timeline@0.1.0-alpha.N
@mcut/editor@0.1.0-alpha.N
@mcut/compositor@0.1.0-alpha.N
@mcut/media@0.1.0-alpha.N
@mcut/react@0.1.0-alpha.N
@mcut/transcription@0.1.0-alpha.N
```

This keeps cross-package compatibility obvious while package boundaries are still
changing. Keep provider and tooling packages on the same alpha train unless
there is a clear reason to skip a package for a given release. Move to
independent versions later only when packages can evolve without coordinated
releases.

Use Changesets in this repo to produce prerelease versions and
publish with the `alpha` dist-tag. Promote to `latest` only when the public API,
docs, examples, and migration story are ready.

## Studio and SDK packages

Studio lives in `apps/studio` and `apps/desktop` in this repo. It uses the local
`@mcut/*` workspaces, so SDK changes show up without a publish step.

Studio ships as a desktop app. The `desktop.yml` workflow packages the Electron
shell with the Studio static export and publishes a macOS disk image and a Linux
AppImage to GitHub Releases. There is no web deployment of Studio. The docs site
at `apps/web` hosts the shadcn registry under `/r` and the agent skill index
under `/.well-known/agent-skills`.

To test a PR's package set in a scratch app, use the pkg.pr.new preview builds
CI publishes for package PRs. Install the URLs from the PR comment, for example
`bun add https://pkg.pr.new/@mcut/timeline@<pr-number>`.
Install every `@mcut/*` package from the same PR number. Do not mix a preview
`@mcut/react` with a published `@mcut/timeline`.

After a package change in this repo, run `bun run typecheck`, `bun run test`,
and the relevant editor E2E tests. Fix any registry or Studio integration drift
before merging.

## Boundary rules

- Reusable project data, commands, invariants, selectors, operators, media
  utilities, compositor code, transcription providers, React runtime helpers,
  CLI code, and MCP server code belong in `packages/*`.
- The Studio renderer owns product UI and app-specific workflows. The desktop
  shell owns persistence, native dialogs, the bridge host, and packaging.
- The shadcn registry in `apps/studio/registry/mcut` can compose UI and depend on
  public `@mcut/*` APIs, but it must not rely on private package internals.
- Public packages must not import from apps, examples, or skills.
