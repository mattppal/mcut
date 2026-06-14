# mcut

Open source video editing SDK for TypeScript apps.

mcut provides a headless timeline engine, command system, renderer, media/export
helpers, transcription adapters, React bindings, CLI tools, and MCP tools. The
commercial mcut Studio GUI is built on top of these packages but is not part of
this repository.

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
```

The first public packages are alpha releases. Expect API movement while the SDK
is still hardening.

## Develop

```sh
bun install
bun run build
bun run typecheck
bun run test
bun run smoke:packages
```

## License

Apache-2.0.
