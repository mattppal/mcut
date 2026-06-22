# Plan 003: Add live bridge readiness checks and clearer recovery guidance

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f03c56f..HEAD -- packages/mcp-server/src/live-bridge.ts packages/mcp-server/src/bridge-cli.ts packages/mcp-server/src/server.test.ts packages/mcp-server/README.md scripts/setup-codex-mcut-env.ts README.md apps/web/content/docs/contributing/devenv.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-setup-command-and-codex-config.md`, `plans/002-make-studio-and-bridge-ports-workspace-safe.md`
- **Category**: dx
- **Planned at**: commit `f03c56f`, 2026-06-21

## Why this matters

The live bridge is a two-step workflow: a local bridge process must be running,
and a Studio browser tab must connect to it. When the browser tab is missing,
the MCP tool error currently tells the user to open "the live editor URL printed
by the MCP server", but the new development flow has `bun run dev` start the
bridge and Codex attach through `mcut-bridge mcp`. In that flow, the MCP server
does not print the URL, so recovery guidance points users at the wrong place.

## Current state

- `packages/mcp-server/src/bridge-cli.ts:147-149` prints the editor URL when `mcut-bridge start` launches the bridge.
- `packages/mcp-server/src/live-bridge.ts:187-193` throws `browser-not-connected` with `No mcut editor tab is connected. Open the live editor URL printed by the MCP server.`
- `scripts/setup-codex-mcut-env.ts:104-107` prints local workflow steps, including the connected editor URL from `localEditorBridgeUrl()`.
- `packages/mcp-server/README.md:1-11` is minimal and does not document the difference between `mcut-mcp-live`, `mcut-bridge start`, and `mcut-bridge mcp`.
- `packages/mcp-server/src/server.test.ts` already covers live bridge forwarding, fixed-port collisions, daemon HTTP target forwarding, and token rejection.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| MCP tests | `bun test packages/mcp-server/src/server.test.ts` | 8+ pass, 0 fail |
| Studio MCP tests | `bun run --filter=mcut-studio-web test` | exits 0 |
| Package typecheck | `bun run typecheck --filter=@mcut/mcp-server` | exits 0 |

## Scope

**In scope**:
- `packages/mcp-server/src/live-bridge.ts`
- `packages/mcp-server/src/bridge-cli.ts`
- `packages/mcp-server/src/server.test.ts`
- `packages/mcp-server/README.md`
- `scripts/setup-codex-mcut-env.ts`
- `README.md`
- `apps/web/content/docs/contributing/devenv.mdx`

**Out of scope**:
- Changing MCP tool names or schemas.
- Hosted Streamable HTTP MCP relay.
- File-backed `mcut-mcp` behavior.
- Studio visual UI changes, except text already shown via toast if necessary.

## Git Workflow

- Stay on the current branch.
- Do not rename the branch.
- Keep changes additive and focused on diagnostics, status, and docs.

## Steps

### Step 1: Make `browser-not-connected` include actionable status context

Change `LiveMcutBridge` so the not-connected error can include the configured
editor URL when available. If the bridge class does not currently store this,
add an optional `editorUrl` or `openEditorUrl` field to `LiveBridgeOptions`.
Populate it in `bridge-cli.ts` and `live-cli.ts`.

The new error should distinguish:

- Bridge process is running but no browser tab is connected.
- Open the connected editor URL.
- If using the dev workflow, run `bun run setup` to print the URL again.

Example shape, adjusted for Plan 002's final port helper:

```text
No mcut editor tab is connected to the live bridge. Open http://localhost:3000/editor?mcpBridge=44737&mcpToken=mcut-local-dev, or run `bun run setup` to print the current workspace URL.
```

Do not include secrets beyond the local dev token already documented by the repo.

**Verify**: Add or update a unit test in `packages/mcp-server/src/server.test.ts` that creates a bridge with the configured URL, calls a target method without connecting a socket, and expects the thrown error text to include `No mcut editor tab is connected` and the URL.

### Step 2: Add a direct status command for the dev workflow

Extend `mcut-bridge status` output, if needed, so it reports:

- `connected: false` when no Studio tab is attached.
- The last known `tab` info when connected.
- The editor URL to open when provided by the CLI or helper.

If status already returns `connected` and `tab`, keep the response backward
compatible and add fields rather than renaming existing ones.

**Verify**:

```sh
bun packages/mcp-server/src/bridge-cli.ts url --editor-url http://localhost:3000/editor --port 44737 --token mcut-local-dev
```

Expected: connected editor URL with `mcpBridge` and `mcpToken` query parameters.

### Step 3: Document the three entrypoints clearly

Expand `packages/mcp-server/README.md` with a compact table:

- `mcut-mcp`: file-backed stdio MCP server for a JSON project.
- `mcut-mcp-live`: stdio MCP server that starts its own live bridge and prints an editor URL.
- `mcut-bridge start` + `mcut-bridge mcp`: persistent bridge plus attachable MCP process, used by the repo dev workflow so Codex does not start a second bridge.

Update root/dev docs only as needed so they link or refer to this table.

**Verify**:

```sh
rg -n 'mcut-mcp-live|mcut-bridge start|mcut-bridge mcp|file-backed|live bridge' packages/mcp-server/README.md README.md apps/web/content/docs/contributing/devenv.mdx
```

Expected: all entrypoints are documented, and the repo dev workflow names
`mcut-bridge start` plus `mcut-bridge mcp` or the scripts that wrap them.

### Step 4: Re-run focused checks

Run focused MCP and Studio tests after diagnostics changes.

**Verify**:

```sh
bun test packages/mcp-server/src/server.test.ts
bun run typecheck --filter=@mcut/mcp-server
bun run --filter=mcut-studio-web test
```

Expected: all exit 0.

## Test Plan

- Add at least one MCP-server unit test for the new not-connected recovery message.
- Add a status-output test only if it can be written without starting long-lived processes; otherwise rely on the `url` command and existing daemon HTTP target tests.
- Existing live bridge tests in `packages/mcp-server/src/server.test.ts` remain the pattern.

## Done Criteria

- [ ] Missing browser-tab errors tell the user exactly which URL to open or how to reprint it.
- [ ] `packages/mcp-server/README.md` clearly distinguishes `mcut-mcp`, `mcut-mcp-live`, and `mcut-bridge start` plus `mcut-bridge mcp`.
- [ ] The repo dev docs no longer imply that Codex always starts the bridge itself.
- [ ] Focused MCP and Studio tests pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Plan 002 changes the dev workflow so there is no stable URL helper to include in errors.
- Including the connected editor URL would expose a non-local secret or hosted session token.
- Status changes require a breaking JSON response shape for existing `mcut-bridge status` consumers.

## Maintenance Notes

Bridge diagnostics should be kept close to the transport layer, not duplicated in
agent prompts. Reviewers should test the failure path intentionally: start Codex
MCP attachment without opening Studio and confirm the tool error tells a
developer exactly what to do next.

