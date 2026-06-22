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

## How mcut Studio consumes SDK packages

mcut Studio consumes local `@mcut/*` workspaces by default. The helper scripts are
still useful when testing Studio against another local worktree, a pkg.pr.new
preview build, or published packages.

Preview flow:

1. Open or update an mcut PR and wait for pkg.pr.new to publish its package set.
2. In this repo, run `bun run mcut:dev preview <pr-number>`.
3. Run Studio with `bun run dev`.
4. Return to published packages with `bun run mcut:dev published`.

The preview helper updates every `@mcut/*` dependency consumed by the Studio app and
the bundled editing skill to the same pkg.pr.new PR URL. Keep that set in
lockstep; do not manually mix a preview `@mcut/react` with a published
`@mcut/timeline`.

Upgrade flow:

1. Release a new alpha from this repo.
2. Install dependencies and commit the package manager lockfile if one is
   generated.
3. Run `bun run typecheck`, `bun run test`, and the relevant editor E2E tests.
4. Fix any registry or Studio integration drift before merging.

## Boundary rules

- Reusable project data, commands, invariants, selectors, operators, media
  utilities, compositor code, transcription providers, React runtime helpers,
  CLI code, and MCP server code belong in `packages/*`.
- The Studio app owns product UI, persistence, API route wiring, deployment
  config, and app-specific workflows.
- The shadcn registry in `apps/studio/registry/mcut` can compose UI and depend on
  public `@mcut/*` APIs, but it must not rely on private package internals.
- Public packages must not import from apps, examples, or skills.
