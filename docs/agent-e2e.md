# Agent driven e2e

`scripts/agent-e2e/run.ts` lets a language model drive the mcut MCP server the way an agent would. It connects an MCP client to `@mcut/mcp-server`, turns `tools/list` into function definitions for the xAI Responses API, routes every function call back through the MCP client, and scores the final project JSON against a task registry. The same loop replays a scripted tool sequence per task with `--dry-run`, so the harness and its scorers run in CI with zero secrets.

A run picks a target and a driver. The target is what the MCP client talks to, the headless stdio server or the Electron desktop app (`apps/desktop`) hosting Studio and the live bridge. The driver is what decides the tool calls, the harness loop calling the xAI Responses API or the Grok Build CLI (`grok`) running headless against the bridge.

## Commands

```sh
bun scripts/agent-e2e/run.ts --dry-run
xvfb-run --auto-servernum -- bun scripts/agent-e2e/run.ts --dry-run --target bridge
xvfb-run --auto-servernum -- bun scripts/agent-e2e/run.ts --dry-run --target bridge --driver grok-build
XAI_API_KEY=xai-... bun scripts/agent-e2e/run.ts
XAI_API_KEY=xai-... xvfb-run --auto-servernum -- bun scripts/agent-e2e/run.ts --target bridge --driver grok-build
XAI_API_KEY=xai-... XAI_MODEL=grok-build-0.1 bun scripts/agent-e2e/run.ts --task silence-cuts --max-steps 12
bun scripts/agent-e2e/run.ts --list
bun test scripts/agent-e2e
xvfb-run --auto-servernum -- bun run fuzz:mcp:bridge
```

Build first. The stdio target needs `bunx turbo run build --filter=@mcut/mcp-server...`, the bridge target needs `bunx turbo run build --filter=mcut-desktop...`, which builds the Studio static export and copies it into the Electron app, and `bun run build` covers both. The default target is the headless stdio server (`packages/mcp-server/src/cli.ts`) writing to a temp project file that is deleted after the run.

The bridge target opens a real Electron window, so it needs a display. On a headless machine wrap the command in `xvfb-run --auto-servernum` as above, after `apt-get install xvfb libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2t64`. On a desktop run it bare and watch the window.

## Environment

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | Required unless `--dry-run`. Missing key exits with code 2 before anything starts. Grok Build reads the same variable. |
| `XAI_MODEL` | Model id for the xai driver, default `grok-4.6`. |
| `XAI_BASE_URL` | API base, default `https://api.x.ai/v1`. |
| `GROK_BUILD_MODEL` | Model id the grok-build driver passes to `grok -m`. Empty lets grok pick its default. |
| `GROK_BIN` | Path to the `grok` binary when it is neither on `PATH` nor in `~/.grok/bin`. |
| `MCUT_BRIDGE_URL` | Full Streamable HTTP MCP URL of a running live bridge, the `MCP_URL` line a separately launched desktop app prints or the output of `bun run scripts/mcut-local-dev.ts mcp-url`. The harness then uses that bridge instead of launching the app itself. |
| `MCUT_BRIDGE_TOKEN` | Pair with the local bridge on `MCUT_BRIDGE_PORT` (default 44737) without spelling out the URL. Appended as `?token=` when `MCUT_BRIDGE_URL` lacks one. |

The bridge is the existing pairing from `bun run dev`. The harness adds no auth of its own. When a bridge target is used, the connected Studio window is the source of truth and every task starts by clearing that project.

## Bridge target

`--target bridge` without `MCUT_BRIDGE_URL` opens a session through `scripts/agent-e2e/bridge-session.ts`. It spawns one process with `Bun.spawn`, the Electron app as `electron apps/desktop --port 0 --token <64 hex chars>` from the repo root with `ELECTRON_RUN_AS_NODE` removed from the environment, reads the `BRIDGE_READY ws://127.0.0.1:<port>/mcut-mcp` line the app prints on stdout, and polls `GET /status` on that port until `connected` is true and the hello frame has arrived. The app serves Studio from `app://studio` and hosts the bridge in its main process, so there is no static file server, no `bridge-cli.ts`, and no Chromium to install. The run directory collects `app.log`, the app's stdout and stderr plus the session's own lines, including the hello frame with the `Electron/` user agent. The Playwright `trace.zip` from the Chromium era is gone, there is no Playwright in the session anymore.

If the app exits while a run is open, the harness reports `the Electron app exited with ...` with the app's last output lines and exits 1 instead of waiting on a dead bridge.

The session also serves media. The app's `app://studio` origin has no route for repo relative paths such as `fixtures/media/counter-vp9-webm.webm`, so `scripts/agent-e2e/fixture-server.ts` runs a `Bun.serve` static server on an ephemeral port that serves only `fixtures/media/` and `apps/studio/e2e/fixtures/`, with CORS headers and byte range requests because mediabunny and the `<video>` element fetch by range. The desktop content security policy allows `http://127.0.0.1:*` for `connect-src` and `media-src`, which is what makes this work. Tasks resolve fixture sources through a `MediaSrc` function, the repo relative path for the stdio target and `http://127.0.0.1:<port>/<path>` for the bridge, so prompts, scripted calls, and scorers agree on the `src` the window actually loads. With `MCUT_BRIDGE_URL` the harness still starts the fixture server so an externally launched app can fetch the media.

## Grok Build driver

`--driver grok-build` needs `--target bridge` and the session the run opens itself. `scripts/agent-e2e/grok-build.ts` writes a temp project directory holding one `.grok/config.toml` whose `mcut-live` entry has the session's `url` (token included) and `enabled = true`, checks the handshake with `grok --trust mcp doctor mcut-live --json`, then runs `grok` once per task with the working directory set to that temp project. The committed `.grok/config.toml` at the repo root is not involved, so a run never touches a developer's paired bridge.

Each task run passes

- `--prompt-file` with the same task prompt the xai driver sends and `--rules` with the harness system prompt plus an instruction to call the `mcut-live` tools directly and stay out of the shell, the file system, and the web,
- `--tools read_file` so the only built in tool is a harmless read while the MCP meta tools stay available, `--max-turns` from `--max-steps`, `--always-approve`, `--no-plan`, `--no-subagents`, `--disable-web-search`, `--no-auto-update`, and `--verbatim`,
- `--output-format streaming-json`, and `-m $GROK_BUILD_MODEL` when set.

The driver parses the newline delimited events. Grok exposes MCP tools through its `search_tool` and `use_tool` meta tools with names prefixed `mcut-live__`, so a `use_tool` call with `tool_name = "mcut-live__addAsset"` becomes an `addAsset` entry in the transcript, `tool_call_update` events supply the result text and error flag, and the `end` event supplies `stopReason`, turn count, token usage, and the model ids that ran. `end_turn` maps to the `model` stop reason, a turn cap to `step-cap` (grok emits a bare `max_turns_reached` event and then ends with `stopReason` `cancelled`), a kill on `--wall-clock-ms` to `wall-clock`, anything else to `error`. The project is then read through the same MCP client and judged by the same scorer as the xai driver, so the report has one shape. An error whose text names authentication (`not signed in`, `XAI_API_KEY`, `401`) ends the run with exit code 2 instead of scoring the task. `<task>.grok.ndjson` and `<task>.prompt.md` land in the run directory next to `grok-mcp-doctor.json`.

`--dry-run` with this driver runs no task. It checks that `grok` is installed, discovers the temp config, and completes the MCP handshake against the bridge, which is the part of the path CI can verify without a key. A failed handshake exits 1 with the doctor report in the run directory. When the `grok` binary is missing the run prints `skipped: grok binary not found` and exits 0 on a dry run, 2 on a live run.

Every invocation passes `--trust`, and grok records that grant for the temp directory in `~/.grok/trusted_folders.toml`, a three line entry per run that outlives the directory. CI runners are ephemeral so this only accumulates on a developer machine.

### What the xAI docs say, checked September 2026

- Install is `curl -fsSL https://x.ai/cli/install.sh | bash` on Linux and macOS and `irm https://x.ai/cli/install.ps1 | iex` on Windows (https://docs.x.ai/build/overview). The binary lands in `~/.grok/bin/grok`, which is where the driver looks after `PATH`.
- Headless mode is `grok -p "<prompt>"`, and `--prompt-file` or `--prompt-json` trigger it too. `--output-format` takes `plain`, `json`, `streaming-json`, or `streaming-messages-json`. `--tools`, `--disallowed-tools`, and `--max-turns` are headless only. `--always-approve` (alias `--yolo`) runs tool calls without prompts. Headless mode does not read piped stdin (https://docs.x.ai/build/overview and https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md).
- `streaming-json` is newline delimited JSON, one `type` tagged object per line derived from ACP session updates, with `toolCallId`, `rawInput`, and `rawOutput` from ACP and `toolName` plus the `usage` line as xAI additions (same guide).
- Exit codes are 0 for success, 1 for authentication, network, or runtime errors, 130 for SIGINT, and 143 for SIGTERM (same guide).
- In non browser environments authentication is `XAI_API_KEY`, with `grok login --device-auth` as the alternative (https://docs.x.ai/build/overview and the headless guide).
- Config scopes are environment, user `~/.grok/config.toml`, project `.grok/config.toml` in the repo, managed, and requirements. Project configs may only contribute MCP servers, plugins, and permission rules, which is all the driver needs (https://docs.x.ai/build/settings). Grok discovers a `.grok/config.toml` at every directory level from the repository root down to the working directory (https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md). On this machine grok 1.0.34 listed the temp directory's `.grok/config.toml` as its `project` layer in `grok inspect --json` with or without a `.git` directory beside it, so the driver relies on the working directory alone.
- `--trust` is absent from `grok --help` and the documented flag tables. Grok's folder trust gate drops project scoped MCP servers in an untrusted directory, and `grok mcp doctor` reports `folder untrusted` with the hint `re-run with --trust to allow repo-local servers` (https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/mcp_doctor.rs). The grant is persisted up front by `grant_folder_trust` (https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/folder_trust.rs).

## Exit codes and reports

`0` every task passed, `1` at least one task failed or the loop hit an error, `2` configuration error (missing key, unknown task, bad flag, grok missing on a live run, grok could not authenticate).

Each run writes `reports/agent-e2e/<timestamp>-<target>[-grok-build][-dry-run]/report.json` (gitignored) holding every `TaskRun` with its tool call transcript, token usage, verdict, and stop reason, and prints a markdown table to stdout. Progress lines go to stderr. Bridge runs add the session logs listed above.

## Caps

`--max-steps` (default 24) bounds model turns that contain tool calls. `--wall-clock-ms` (default 180000) bounds the whole task including setup. A task that hits a cap or throws is scored anyway but fails with the stop reason as its first reason, because an agent that never declares itself done is a failure mode the loop exists to catch.

## Tasks

The registry lives in `scripts/agent-e2e/tasks.ts`. Every task is an `E2ETask` with `id`, `title`, `prompt`, `fixtures`, `setup` commands dispatched before the model sees the project, a `scripted` tool sequence used by `--dry-run`, and a `score(project, transcript)` function returning `{ pass, reasons }`.

| Task | Target | Setup | Scored on |
| --- | --- | --- | --- |
| `import-and-place` | any | empty project | asset registered with the fixture src, one untrimmed clip at 0 for the full duration |
| `split-and-drop-head` | any | clip placed | one clip left, starting at 0, trimmed to source 1000 ms, no gap |
| `title-overlay` | any | clip placed | one text element with the title, spanning the clip, on a track above the video |
| `silence-cuts` | any | clip placed plus word timed captions | clips butt from 0, every word still covered, leading, middle, and trailing silence removed |
| `reformat-vertical` | any | 1920x1080 project, clip placed | project is 1080x1920, clip scaled to cover the frame and centered |
| `fade-open-close` | any | clip placed | opacity keyframes 0 at start, 1 by 400 ms, 1 until 400 ms before the end, 0 at the end |
| `bridge-fade-action` | bridge | clip placed | `effects.fade-open-close` ran through `run_action`, then the fade checks |
| `bridge-remove-silence-action` | bridge | clip placed plus word timed captions | `transcript.remove-silence` ran through `run_action`, then the silence checks |
| `bridge-export-webm` | bridge | empty project | asset registered with the served src, one untrimmed clip at 0, `file.export-video` ran through `run_action` with `{"format": "webm"}` and returned `format` `webm`, a `video/webm` mime type, and a byte count above 0 |

Tasks with `target: 'bridge'` call `run_action`, which only the live bridge serves, so the stdio target skips them. `file.export-video` is an agent only action in `apps/studio/registry/mcut/editor-default-actions.ts` (kept out of the palette) that renders the timeline with `exportProject` from `@mcut/media` inside the tab, triggers the browser download, and returns format, mime type, byte size, duration, and render time so a headless client can check the export without touching the download.

Fixtures resolve by manifest id from `fixtures/media/manifest.json` when that file exists and fall back to the committed `apps/studio/e2e/fixtures/fixture-vp9.mkv` (640x360, 30 fps, 2008 ms). `createTasks(srcOf)` builds the registry for one `MediaSrc`, and `TASKS` is the repo relative build the stdio target and the tests use. Prompts and scorers are derived from the resolved fixture, so the tasks keep working when the manifest lands.

`scripts/agent-e2e/tasks.test.ts` runs every headless scripted sequence through an in memory MCP server and asserts it passes its own scorer, that the headless server rejects the bridge tasks' `run_action` calls, that an agent which edits nothing fails every scorer, and that scripted calls only name tools the server advertises. Add a task inside `createTasks` with a scripted solution and the test keeps it honest.

## Grok Build from the repo root

Grok Build is the xAI terminal coding agent (`grok`). It reads project scoped MCP servers from `.grok/config.toml`, which this repo ships with two entries for interactive use. The grok-build driver above writes its own config in a temp directory and never reads this one.

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

## Fuzzing the bridge

`bun run fuzz:mcp:bridge` (`scripts/agent-e2e/fuzz-bridge.ts`) opens the same Electron session, connects the MCP fuzz client from `packages/mcp-server/src/fuzz` over Streamable HTTP, and runs 20 random sequences of 20 tool calls against the app, resetting the project between seeds and checking the project invariants from `packages/timeline/src/fuzz`. `ensure_transcript` and `ensure_voice_stems` are left out because transcription and voice cleanup can take minutes. A violated invariant is minimized and printed with the `MCUT_FUZZ_SEED=<n>` line that reproduces it. `--seeds`, `--length`, and `--seed`, or `MCUT_FUZZ_SEQUENCES`, `MCUT_FUZZ_LENGTH`, and `MCUT_FUZZ_SEED`, resize the window.

## CI

`.github/workflows/agent-e2e.yml` runs every Monday at 07:00 UTC and on `workflow_dispatch` with optional `target`, `model`, and `tasks` inputs. Pull requests that touch `scripts/agent-e2e/**`, `apps/studio/**`, `apps/desktop/**`, `packages/desktop-ipc/**`, `packages/mcp-server/**`, `packages/timeline/**`, or the workflow run the two dry run jobs.

The bridge jobs build the desktop app with `bunx turbo run build --filter=mcut-desktop...`, install `xvfb` and the Electron runtime libraries with `apt-get`, set `kernel.apparmor_restrict_unprivileged_userns=0` so the Chromium sandbox can start on the Ubuntu 24.04 runner (https://github.com/microsoft/playwright/issues/34251), and run the harness under `xvfb-run --auto-servernum`. Electron's `cli.js` downloads the Electron binary on first launch, so the job needs network but no extra install step.

| Job | Runs on | Needs the key | Does |
| --- | --- | --- | --- |
| `dry-run` | pull requests, schedule, dispatch | no | typechecks and tests the harness, replays the scripted tasks through the stdio server |
| `bridge-dry-run` | pull requests, schedule, dispatch | no | builds the desktop app, installs Xvfb and Grok Build, replays the scripted tasks including the WebM export through the Electron app, checks that grok discovers the bridge config and completes the MCP handshake, fuzzes the bridge for 20 seeds |
| `live` | schedule, dispatch | yes | the xai driver against the `target` input, stdio by default |
| `bridge-live` | schedule, dispatch | yes | installs Grok Build and lets it run every bridge task against the Electron app over the live bridge |

The live jobs read the `XAI_API_KEY` repository secret and skip with a notice when it is empty. Every job appends the markdown table to the job summary and uploads `reports/agent-e2e` as an artifact whatever the outcome.
