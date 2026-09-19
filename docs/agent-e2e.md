# Agent driven e2e

`scripts/agent-e2e/run.ts` lets a language model drive the mcut MCP server the way an agent would. It connects an MCP client to `@mcut/mcp-server`, turns `tools/list` into function definitions for the xAI Responses API, routes every function call back through the MCP client, and scores the final project JSON against a task registry. The same loop replays a scripted tool sequence per task with `--dry-run`, so the harness and its scorers run in CI with zero secrets.

## Commands

```sh
bun scripts/agent-e2e/run.ts --dry-run
XAI_API_KEY=xai-... bun scripts/agent-e2e/run.ts
XAI_API_KEY=xai-... XAI_MODEL=grok-build-0.1 bun scripts/agent-e2e/run.ts --task silence-cuts --max-steps 12
bun scripts/agent-e2e/run.ts --list
bun test scripts/agent-e2e
```

Build `@mcut/mcp-server` and its dependencies first (`bun run build`, or `bunx turbo run build --filter=@mcut/mcp-server...`). The default target is the headless stdio server (`packages/mcp-server/src/cli.ts`) writing to a temp project file that is deleted after the run.

## Environment

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | Required unless `--dry-run`. Missing key exits with code 2 before anything starts. |
| `XAI_MODEL` | Model id, default `grok-4.6`. |
| `XAI_BASE_URL` | API base, default `https://api.x.ai/v1`. |
| `MCUT_BRIDGE_URL` | Full Streamable HTTP MCP URL of a running live bridge, for example the output of `bun run scripts/mcut-local-dev.ts mcp-url`. |
| `MCUT_BRIDGE_TOKEN` | Pair with the local bridge on `MCUT_BRIDGE_PORT` (default 44737) without spelling out the URL. Appended as `?token=` when `MCUT_BRIDGE_URL` lacks one. |

The bridge is the existing pairing from `bun run dev`. The harness adds no auth of its own. When a bridge target is used, the connected Studio tab is the source of truth and every task starts by clearing that project.

## Exit codes and reports

`0` every task passed, `1` at least one task failed or the loop hit an error, `2` configuration error (missing key, unknown task, bad flag).

Each run writes `reports/agent-e2e/<timestamp>/report.json` (gitignored) holding every `TaskRun` with its tool call transcript, token usage, verdict, and stop reason, and prints a markdown table to stdout. Progress lines go to stderr.

## Caps

`--max-steps` (default 24) bounds model turns that contain tool calls. `--wall-clock-ms` (default 180000) bounds the whole task including setup. A task that hits a cap or throws is scored anyway but fails with the stop reason as its first reason, because an agent that never declares itself done is a failure mode the loop exists to catch.

## Tasks

The registry lives in `scripts/agent-e2e/tasks.ts`. Every task is an `E2ETask` with `id`, `title`, `prompt`, `fixtures`, `setup` commands dispatched before the model sees the project, a `scripted` tool sequence used by `--dry-run`, and a `score(project, transcript)` function returning `{ pass, reasons }`.

| Task | Setup | Scored on |
| --- | --- | --- |
| `import-and-place` | empty project | asset registered with the fixture path, one untrimmed clip at 0 for the full duration |
| `split-and-drop-head` | clip placed | one clip left, starting at 0, trimmed to source 1000 ms, no gap |
| `title-overlay` | clip placed | one text element with the title, spanning the clip, on a track above the video |
| `silence-cuts` | clip placed plus word timed captions | clips butt from 0, every word still covered, leading, middle, and trailing silence removed |
| `reformat-vertical` | 1920x1080 project, clip placed | project is 1080x1920, clip scaled to cover the frame and centered |
| `fade-open-close` | clip placed | opacity keyframes 0 at start, 1 by 400 ms, 1 until 400 ms before the end, 0 at the end |

Fixtures resolve by manifest id from `fixtures/media/manifest.json` when that file exists and fall back to the committed `apps/studio/e2e/fixtures/fixture-vp9.mkv` (640x360, 30 fps, 2008 ms). Prompts and scorers are derived from the resolved fixture, so the tasks keep working when the manifest lands.

`scripts/agent-e2e/tasks.test.ts` runs every scripted sequence through an in memory MCP server and asserts it passes its own scorer, that an agent which edits nothing fails every scorer, and that scripted calls only name tools the server advertises. Add a task by appending to `TASKS` with a scripted solution and the test keeps it honest.

## Grok Build

Grok Build is the xAI terminal coding agent (`grok`). It reads project scoped MCP servers from `.grok/config.toml`, which this repo ships with two entries.

| Server | Transport | What it edits |
| --- | --- | --- |
| `mcut` | stdio, `bun packages/mcp-server/src/cli.ts ${MCUT_PROJECT:-project.mcut.json}` | the JSON project file on disk |
| `mcut-live` | HTTP, `http://127.0.0.1:${MCUT_BRIDGE_PORT:-44737}/mcp?token=${MCUT_BRIDGE_TOKEN:-mcut-local-dev}` | the Studio tab connected through `bun run dev` |

```sh
export XAI_API_KEY=xai-...
bun install && bun run build
grok inspect
grok mcp doctor mcut
grok -p "Register apps/studio/e2e/fixtures/fixture-vp9.mkv as a video asset and place it at 0 on a new track"
```

`mcut-live` ships disabled so a missing bridge does not fail startup. Start Studio and the bridge with `bun run dev`, then flip `enabled = true` or toggle the server from `/mcps` in the TUI. Run `grok` from the repo root so the relative path in the stdio entry resolves. Grok also merges project `.mcp.json` and `.cursor/mcp.json` files below `config.toml`.

## xAI research notes, September 2026

- Grok Build is a product, the SpaceXAI coding agent CLI and TUI, open sourced under Apache 2.0 at https://github.com/xai-org/grok-build (announcements at https://x.ai/news/grok-build-cli and https://x.ai/news/grok-build-open-source, docs at https://docs.x.ai/build/overview). It runs interactively, headlessly with `grok -p`, and over ACP. In non browser environments it authenticates with `XAI_API_KEY`.
- Grok Build is an MCP client. Servers are declared in `~/.grok/config.toml` or a project `.grok/config.toml` under `[mcp_servers.<name>]` with `command`, `args`, `env`, `cwd` for stdio or `url`, `headers`, `bearer_token_env_var` for HTTP and SSE, with `${VAR}` and `${VAR:-default}` expansion (https://docs.x.ai/build/features/mcp-servers and https://docs.x.ai/build/settings/reference). Project configs may only contribute `[mcp_servers]`, `[plugins]`, and `[permission]` (https://docs.x.ai/build/settings).
- The REST API supports client side function calling on `POST /v1/responses` with flat `{ "type": "function", "name", "description", "parameters" }` tools, `function_call` output items, `function_call_output` inputs, and `previous_response_id` chaining (https://docs.x.ai/docs/guides/function-calling). This is what the harness uses.
- The REST API also documents server side Remote MCP Tools, `{ "type": "mcp", "server_url", "server_label", "allowed_tools", "authorization", "headers" }`, where xAI connects to the MCP server itself. Only Streamable HTTP and SSE transports are supported (https://docs.x.ai/developers/tools/remote-mcp). The mcut bridge listens on 127.0.0.1, so this path needs a public relay such as the one sketched in `docs/cloudflare-mcp-relay.md`. The API reference at https://docs.x.ai/docs/api-reference still states that only functions and web search are supported as tools, which contradicts the remote MCP guide. Treat the guide as current and the reference as stale, an inference.
- Current text model ids listed at https://docs.x.ai/docs/models are `grok-4.6` (recommended for code), `grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`, `grok-4.20-multi-agent-0309`, and `grok-build-0.1`. The model behind Grok Build is described as `grok-build-0.1` at https://x.ai/news/grok-build-0-1 and as `grok-4.5` at https://docs.x.ai/build/overview, so the two pages disagree. The harness default is `grok-4.6`, and `XAI_MODEL=grok-build-0.1` is the cheaper coding model.
- Responses are stored by xAI for 30 days when `previous_response_id` chaining is used (https://docs.x.ai/docs/api-reference). The harness sends the task prompt, fixture metadata, tool schemas, and tool results, nothing secret.

## CI

`.github/workflows/agent-e2e.yml` runs every Monday at 07:00 UTC and on `workflow_dispatch` with optional `model` and `tasks` inputs. The `dry-run` job needs no secrets and also runs on pull requests that touch `scripts/agent-e2e/**`. The `live` job reads the `XAI_API_KEY` repository secret and skips with a notice when it is empty. Both jobs append the markdown table to the job summary and upload `reports/agent-e2e` as an artifact.
