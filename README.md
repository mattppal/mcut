# mcut

[![CI](https://github.com/mattppal/mcut/actions/workflows/ci.yml/badge.svg)](https://github.com/mattppal/mcut/actions/workflows/ci.yml)

Open source video editing SDK for TypeScript apps.

mcut provides a headless timeline engine, command system, renderer, media/export
helpers, transcription adapters, React bindings, CLI tools, and MCP tools. The
commercial mcut Studio GUI is built on top of these packages but is not part of
this repository.

The first public packages are alpha releases. Expect API movement while the SDK
is still hardening.

## Packages

- `@mcut/timeline` - project model, serializable commands, undo/redo, selectors
- `@mcut/editor` - user-level operators and pure edit/gesture planning
- `@mcut/compositor` - Canvas2D frame rendering and hit testing
- `@mcut/media` - probing, thumbnails, preview media, browser WebCodecs export
- `@mcut/react` - React provider, hooks, and player canvas bindings
- `@mcut/transcription` - provider interface, normalized transcripts, captions,
  SRT, and VTT
- `@mcut/transcription-ai-sdk`, `@mcut/transcription-assemblyai`,
  `@mcut/transcription-local` - transcription providers
- `@mcut/cli` - headless CLI
- `@mcut/mcp-server` - MCP and local browser bridge tooling

## Install

```sh
bun add @mcut/timeline @mcut/editor
bunx @mcut/cli --help
```

## Docs

- Website docs: <https://mcut.com/docs>
- Quickstart: <https://mcut.com/docs/quickstart>
- Agent instructions: <https://mcut.com/docs/agent-instructions>
- Contributor docs: <https://mcut.com/docs/contributing/devenv>
- Local package READMEs live beside each package in `packages/*/README.md`.

## Develop

This is a Bun workspace monorepo managed with Turbo:

- `packages/*` contains the publishable `@mcut/*` SDK packages.
- `examples/*` contains runnable package examples.
- `apps/*` contains applications, including the web app in `apps/web`.

```sh
bun install
bun run build
bun run typecheck
bun run test
bun run lint
bun run smoke:packages
```

To run only the web app:

```sh
bun run dev:web
```

The full release gate is:

```sh
bun run release:check
```

Website docs live in `apps/web/content/docs`. The site build generates Fumadocs
sources and static `.md` mirrors for docs pages.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Public API
or package behavior changes should include a Changesets entry:

```sh
bunx changeset
```

The contributor workflow is also available in the website docs:
[development environment](https://mcut.com/docs/contributing/devenv) and
[contributing guide](https://mcut.com/docs/contributing/contributing).

Security issues should be reported privately through
[SECURITY.md](SECURITY.md), not through public issues.

## Governance

Project roles, maintainer access, and decision-making are documented in
[GOVERNANCE.md](GOVERNANCE.md). Release mechanics are documented in
[docs/RELEASES.md](docs/RELEASES.md), and npm namespace/trusted-publishing setup
is documented in [docs/npm-publishing.md](docs/npm-publishing.md).

## License

Apache-2.0.
