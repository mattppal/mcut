# Plan 002: Make Studio and bridge ports workspace-safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f03c56f..HEAD -- package.json .conductor/settings.toml packages/mcp-server/package.json scripts/mcut-local-dev.ts scripts/codex-mcp.sh scripts/setup-codex-mcut-env.ts README.md apps/studio/README.md apps/web/content/docs/contributing/devenv.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-restore-setup-command-and-codex-config.md`
- **Category**: dx
- **Planned at**: commit `f03c56f`, 2026-06-21

## Why this matters

The new dev workflow starts Studio and a bridge together, but it hard-codes
Studio to port `3000` and the bridge to `44737`. That works for one local
checkout, but it conflicts with Conductor's parallel-workspace model where each
workspace gets its own `CONDUCTOR_PORT` range. In the current Conductor
environment, `CONDUCTOR_PORT=55010`, while docs and scripts still point agents
and humans to `localhost:3000`.

## Current state

- `package.json:13` runs `turbo run dev bridge --filter=mcut-studio-web --filter=@mcut/mcp-server`.
- `.conductor/settings.toml:6` still runs the docs web app, not Studio: `cd apps/web && bun run dev -- --port "$CONDUCTOR_PORT"`.
- `packages/mcp-server/package.json:27` defines `bridge` as `bun src/bridge-cli.ts start --port 44737 --token mcut-local-dev --editor-url http://localhost:3000/editor`.
- `scripts/mcut-local-dev.ts:1-3` exports fixed `LOCAL_BRIDGE_PORT = 44737`, `LOCAL_BRIDGE_TOKEN = 'mcut-local-dev'`, and `LOCAL_EDITOR_URL = 'http://localhost:3000/editor'`.
- `scripts/codex-mcp.sh:7` attaches Codex to fixed bridge port `44737`.
- `README.md:50-57` and `apps/web/content/docs/contributing/devenv.mdx:41-57` document only the fixed `3000`/`44737` URL.
- Conductor guidance from the bundled skill: use `CONDUCTOR_PORT` for local servers and nearby allocated ports for companion services when multiple workspaces can run concurrently.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Setup compatibility | `bun run setup` | exit 0 |
| Studio test | `bun run --filter=mcut-studio-web test` | exit 0 |
| MCP test | `bun test packages/mcp-server/src/server.test.ts` | 8 pass, 0 fail |
| Config grep | `rg -n 'localhost:3000|44737' package.json .conductor/settings.toml packages/mcp-server/package.json scripts README.md apps/studio/README.md apps/web/content/docs/contributing/devenv.mdx` | only intentional fallback/default mentions remain |

## Scope

**In scope**:
- `package.json`
- `.conductor/settings.toml`
- `packages/mcp-server/package.json`
- `scripts/mcut-local-dev.ts`
- `scripts/codex-mcp.sh`
- `scripts/setup-codex-mcut-env.ts`
- `README.md`
- `apps/studio/README.md`
- `apps/web/content/docs/contributing/devenv.mdx`

**Out of scope**:
- Hosted MCP relay work in `docs/cloudflare-mcp-relay.md`.
- Changing the MCP protocol or tool list.
- Editing Studio UI components.
- Changing generated SDK reference docs.

## Git Workflow

- Stay on the current branch.
- Do not rename the branch.
- Keep the change focused on local development orchestration and docs.

## Steps

### Step 1: Centralize local port and URL resolution

Update `scripts/mcut-local-dev.ts` so it derives values from environment
variables with fixed local fallbacks:

- `MCUT_STUDIO_PORT` defaults to `CONDUCTOR_PORT` when present, otherwise `3000`.
- `MCUT_BRIDGE_PORT` defaults to `CONDUCTOR_PORT + 1` when `CONDUCTOR_PORT` is present, otherwise `44737`.
- `MCUT_BRIDGE_TOKEN` defaults to `mcut-local-dev`.
- `MCUT_EDITOR_URL` defaults to `http://localhost:${studioPort}/editor`.

Export helpers for:

- `localStudioPort()`
- `localBridgePort()`
- `localBridgeToken()`
- `localEditorUrl()`
- `localEditorBridgeUrl()`

Keep the helpers pure and Bun/Node-compatible.

**Verify**:

```sh
bun -e 'import { localEditorBridgeUrl } from "./scripts/mcut-local-dev.ts"; console.log(localEditorBridgeUrl())'
CONDUCTOR_PORT=55010 bun -e 'import { localEditorBridgeUrl } from "./scripts/mcut-local-dev.ts"; console.log(localEditorBridgeUrl())'
```

Expected:

- Without `CONDUCTOR_PORT`: `http://localhost:3000/editor?mcpBridge=44737&mcpToken=mcut-local-dev`
- With `CONDUCTOR_PORT=55010`: `http://localhost:55010/editor?mcpBridge=55011&mcpToken=mcut-local-dev`

### Step 2: Make the bridge and Codex wrapper use the shared helper

Change the package `bridge` script so it invokes a small TypeScript launcher or
uses environment-expanded values from the helper. Prefer a new script such as
`scripts/mcut-bridge-dev.ts` if package JSON quoting becomes fragile.

The effective command must run:

```sh
bun packages/mcp-server/src/bridge-cli.ts start \
  --port <localBridgePort> \
  --token <localBridgeToken> \
  --editor-url <localEditorUrl>
```

Update `scripts/codex-mcp.sh` so it attaches to `localBridgePort()` instead of
fixed `44737`. If a shell script cannot import the TypeScript helper cleanly,
replace it with a TypeScript wrapper and update generated `.codex/config.toml`
accordingly.

**Verify**:

```sh
CONDUCTOR_PORT=55010 bun packages/mcp-server/src/bridge-cli.ts url --port 55011 --token mcut-local-dev --editor-url http://localhost:55010/editor
```

Expected: `http://localhost:55010/editor?mcpBridge=55011&mcpToken=mcut-local-dev`

### Step 3: Make Conductor run Studio, not the docs app

Update `.conductor/settings.toml` so the Run button starts the local editor and
bridge workflow, not `apps/web`. After Plan 001, setup should use `bun run
setup`. The run command should set the workspace-local port and run the root dev
script, for example:

```toml
setup = "bun install --frozen-lockfile && bun run setup"
run = 'MCUT_STUDIO_PORT="$CONDUCTOR_PORT" MCUT_BRIDGE_PORT="$((CONDUCTOR_PORT + 1))" bun run dev'
run_mode = "concurrent"
```

If TOML/shell quoting for arithmetic is unreliable in Conductor, move this into
a repo script such as `scripts/conductor-run.sh` and call that from
`.conductor/settings.toml`.

**Verify**:

```sh
CONDUCTOR_PORT=55010 zsh -lc 'MCUT_STUDIO_PORT="$CONDUCTOR_PORT" MCUT_BRIDGE_PORT="$((CONDUCTOR_PORT + 1))" bun -e "console.log(process.env.MCUT_STUDIO_PORT, process.env.MCUT_BRIDGE_PORT)"'
```

Expected: `55010 55011`.

### Step 4: Pass the Studio port to Next

Ensure the Studio dev task receives the selected port. Options, in preferred
order:

1. Change the root `dev` script to invoke a repo script that starts both
   processes with computed environment variables.
2. Change the `mcut-studio-web` `dev` script to honor `MCUT_STUDIO_PORT`, for
   example `next dev --port ${MCUT_STUDIO_PORT:-3000}` if the package shell
   supports it.
3. Add a dedicated `dev:studio:mcp` script that owns the orchestration and leave
   plain package `dev` alone.

Do not regress `bun run dev:web`, which should continue to run only the docs
site.

**Verify**:

```sh
MCUT_STUDIO_PORT=55010 MCUT_BRIDGE_PORT=55011 bun run dev
```

Expected: Turbo starts Studio on `localhost:55010` and the bridge on `55011`.
Terminate the command after confirming both startup lines.

### Step 5: Update docs to show defaults and Conductor behavior

Update `README.md`, `apps/studio/README.md`, and
`apps/web/content/docs/contributing/devenv.mdx` so they say:

- Local default: Studio `3000`, bridge `44737`.
- Conductor workspaces: Studio uses `CONDUCTOR_PORT`, bridge uses
  `CONDUCTOR_PORT + 1`.
- The connected editor URL is printed by setup or can be generated by
  `bun run setup`.
- Codex attaches to the already-running local bridge; it should not start a
  second bridge in the dev workflow.

**Verify**:

```sh
rg -n 'CONDUCTOR_PORT|3000|44737|mcpBridge|mcut-live' README.md apps/studio/README.md apps/web/content/docs/contributing/devenv.mdx
```

Expected: docs mention both default local ports and Conductor-derived ports.

## Test Plan

- Add focused tests for `scripts/mcut-local-dev.ts` if this repo has script tests by execution time; otherwise verify with `bun -e` commands above.
- Existing coverage to run:
  - `bun test packages/mcp-server/src/server.test.ts`
  - `bun run --filter=mcut-studio-web test`
- Manual startup check:
  - `MCUT_STUDIO_PORT=55010 MCUT_BRIDGE_PORT=55011 bun run dev`

## Done Criteria

- [ ] Local defaults still produce `http://localhost:3000/editor?mcpBridge=44737&mcpToken=mcut-local-dev`.
- [ ] `CONDUCTOR_PORT=55010` produces `http://localhost:55010/editor?mcpBridge=55011&mcpToken=mcut-local-dev`.
- [ ] `.conductor/settings.toml` starts the Studio + bridge workflow, not the docs app.
- [ ] `scripts/codex-mcp.sh` or its replacement attaches to the derived bridge port.
- [ ] Docs explain both local defaults and Conductor workspace behavior.
- [ ] Focused MCP and Studio tests pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Turbo cannot pass distinct environment variables to the Studio and bridge tasks without a larger orchestration rewrite.
- Conductor does not expose `CONDUCTOR_PORT` to setup/run scripts in the target environment.
- The final solution requires changing hosted Studio or Cloudflare MCP relay behavior.
- Port-safe startup requires touching files outside the in-scope list.

## Maintenance Notes

The important invariant is that one workspace owns one Studio port and one
bridge port. Any future docs or scripts that reintroduce fixed `localhost:3000`
or `44737` should label them as local defaults, not universal development
instructions.

