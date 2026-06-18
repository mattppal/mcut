# Cloudflare MCP Relay Architecture

## Goal

Simplify live bridge startup for hosted mcut Studio.

Today, live browser editing through MCP depends on a local bridge process and a
browser URL with bridge query parameters. The hosted flow should remove that
manual startup step:

- Every hosted editor session automatically registers a bridge channel.
- Codex connects through a remote MCP server.
- The browser editor remains the source of truth for live project state.
- Local bridge commands remain available for offline and development workflows.

## Recommended Architecture

Use an adjacent Cloudflare Worker backed by a Durable Object relay.

The Worker should be deployed separately from the Studio Next app, either behind
`https://app.mcut.io/mcp` or a dedicated subdomain such as
`https://mcp.app.mcut.io/mcp`. The Studio app owns product UI and browser editor
state. The relay Worker owns remote MCP transport, WebSocket presence, and
session routing.

The core object is `SessionDurableObject`. It represents a user's live mcut
editing session, accepts the editor tab WebSocket, and forwards MCP tool calls
to the active browser tab using the existing live bridge request vocabulary.

The relay must not become the project state owner in v1. It should hold only the
minimum metadata required to route requests and recover from Durable Object
hibernation.

## Connection UX

The primary UX should be one-time Codex setup:

```sh
codex mcp add mcut --url https://app.mcut.io/mcp
codex mcp login mcut
```

After that, every hosted editor session is automatically available to Codex.
The editor should expose a `Connect Codex` action with these states:

- Not installed: show the `codex mcp add` and `codex mcp login` commands.
- Installed but unauthenticated: show `codex mcp login mcut`.
- Connected: show `Codex ready`, the active session, connected client count, and
  a revoke action.
- Multiple tabs open: show `Use this tab for Codex` to mark the current tab as
  the active target.

MCP should default tool calls to the active editor session. Provide session
management tools for ambiguity:

- `list_sessions`
- `get_active_session`
- `select_session`

## Runtime Flow

1. A user opens `https://app.mcut.io/editor`.
2. The editor calls the relay to create or resume a session.
3. The editor opens a WebSocket to the relay, for example
   `wss://app.mcut.io/bridge/sessions/:sessionId`.
4. The editor sends the existing live bridge `hello` message with tab metadata.
5. Codex connects to `https://app.mcut.io/mcp` using Streamable HTTP MCP.
6. Codex authenticates through OAuth and receives access scoped to the user's
   mcut account.
7. An MCP tool call reaches the Worker, which routes it to the correct
   `SessionDurableObject`.
8. The Durable Object forwards the request to the active browser tab.
9. The browser executes the request against the live editor engine and returns
   the result.
10. The Durable Object returns the MCP response to Codex.

The existing request types should remain the wire vocabulary between relay and
browser, including project context, transcript tools, actions, operators, raw
commands, undo, and redo.

## Durable Object Responsibilities

`SessionDurableObject` should own:

- Browser WebSocket acceptance and lifecycle.
- MCP request routing for a single user's session scope.
- Active tab selection when multiple browser tabs are connected.
- Pending request ids, timeouts, response matching, and cancellation on
  disconnect.
- Session metadata such as project name, user agent, connection timestamps, and
  active status.
- Revocation and expiry state.
- Minimal persisted state needed to recover from Durable Object hibernation.

It should not own:

- Full project documents.
- Media blobs.
- Export jobs.
- Browser-only capabilities such as WebCodecs rendering or on-device Whisper.
- Long-term project persistence.

## Security

Use OAuth for Codex authentication. Codex supports remote Streamable HTTP MCP
servers and `codex mcp login` for OAuth-backed MCP servers.

Keep browser session auth separate from Codex MCP auth:

- Browser tabs authenticate to the relay with a session-scoped browser token.
- Codex authenticates with OAuth and account-scoped access.
- The relay maps authenticated Codex users to their active editor sessions.
- Session tokens are high entropy, scoped, revocable, and expire on inactivity.

Enforce transport protections:

- Use HTTPS and WSS in hosted environments.
- Validate `Origin` for browser WebSocket upgrades.
- Reject cross-origin browser RPC access unless explicitly allowed.
- Do not expose unauthenticated public listeners.
- Return a clear `browser-not-connected` style error when no active editor tab is
  connected.

The relay should never persist full project state or uploaded media in v1. That
keeps the privacy model aligned with browser-source editing.

## Fallbacks

Keep the current local bridge flows:

```sh
bunx -p @mcut/mcp-server mcut-mcp-live --editor-url http://localhost:3000/editor
bunx -p @mcut/mcp-server mcut-bridge start --editor-url http://localhost:3000/editor
bunx -p @mcut/mcp-server mcut-bridge mcp
```

Use these for:

- Local development.
- Offline workflows.
- Self-hosted editors without the hosted relay.
- Debugging remote relay issues.

The hosted Cloudflare relay should be the default documented path for
`app.mcut.io`, while the local bridge remains the escape hatch.

## Test Plan

Test the Durable Object relay:

- Browser connects and sends `hello`.
- MCP request forwards to the active browser tab.
- Browser response resolves the pending MCP request.
- Browser disconnect fails pending requests.
- Request timeout returns a clear MCP error.
- Revoked sessions reject new browser and MCP requests.
- Multiple tabs can connect, and active tab selection is deterministic.
- Durable Object hibernation can restore enough state to keep session routing
  correct after wake.

Test remote MCP integration:

- MCP initialize succeeds.
- `tools/list` returns the expected mcut tool surface.
- `tools/call` reaches the active browser session.
- Unauthenticated MCP requests fail.
- Authenticated users cannot access another user's sessions.

Test browser behavior:

- Hosted editor auto-registers without `mcpBridge` query parameters.
- `Connect Codex` UI reflects install, login, connected, and revoked states.
- `Use this tab for Codex` updates the active session.

Regression-test local fallback:

- Existing `mcut-mcp-live` tests continue to pass.
- Existing `mcut-bridge start` plus `mcut-bridge mcp` tests continue to pass.

## References

- Codex MCP configuration supports Streamable HTTP servers and OAuth login:
  https://developers.openai.com/codex/mcp
- Cloudflare Durable Objects support stateful WebSocket coordination and
  WebSocket Hibernation:
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
