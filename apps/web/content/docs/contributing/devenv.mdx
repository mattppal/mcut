---
title: Development environment
description: Install the mcut monorepo, run local development, and validate changes.
---

## Prerequisites

mcut is a Bun workspace monorepo managed with Turbo.

- Use Bun `1.3.14`.
- Package consumers should use Node `20.11` or newer.
- Run commands from the repository root unless a package README says otherwise.

## Install

```sh
bun install
```

CI uses a frozen lockfile:

```sh
bun install --frozen-lockfile
```

## Workspace layout

- `packages/*`: publishable `@mcut/*` SDK packages.
- `examples/*`: runnable examples for headless editing and MCP workflows.
- `apps/web`: the marketing site and `/docs` implementation.
- `docs/`: maintainer and release process notes for the repository.

## Run locally

Run every persistent development task through Turbo:

```sh
bun run dev
```

Run only the marketing site and docs:

```sh
bun run dev:web
```

For a specific port, run the web app directly:

```sh
cd apps/web
bun run dev -- --port 3000
```

## Validate changes

Use the narrowest command that covers your change while working, then run the
broader checks before opening a pull request.

```sh
bun run build
bun run typecheck
bun run test
bun run lint
bun run smoke:packages
```

Release validation runs the full package gate:

```sh
bun run release:check
```

`release:check` builds packages, typechecks, runs tests, runs package smoke
checks, and validates package metadata.

## Website docs

The website docs are written in `apps/web/content/docs`. The web app generates
Fumadocs sources and static Markdown mirrors during build:

```sh
bun run --filter=mcut-web build
```

Use the web package checks when editing docs or site code:

```sh
bun run --filter=mcut-web typecheck
bun run --filter=mcut-web lint
```
