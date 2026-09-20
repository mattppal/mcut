# Cloudflare MCP relay architecture

Status. Studio ships as a desktop app from GitHub Releases and has no web
deployment, so the hosted editor this design assumes does not exist. The bridge
runs inside the app on port `44737`. The document stays as design history for
a remote relay.

## Goal

Simplify live bridge startup for hosted mcut Studio.

Today, live browser editing through MCP depends on a local bridge process and a
browser URL with bridge query parameters. The hosted flow should remove that
manual startup step.

- Every hosted editor session automatically registers a bridge channel.
- Any MCP client that supports Streamable HTTP connects through a remote MCP
  server.
- The browser editor remains the source of truth for live project state.
- Local bridge commands remain available for offline and development workflows.

## Recommended architecture

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

The hosted MCP endpoint is `https://app.mcut.io/mcp`. Clients authenticate with
a `token` query parameter, the same shape the local bridge prints.

Point any Streamable HTTP MCP client at that URL. In Cursor, add it to
`mcp.json`.

```json
{
  "mcpServers": {
    "mcut": {
      "url": "https://app.mcut.io/mcp?token=<session-token>"
    }
  }
}
```

After that, every hosted editor session is available to the connected client.
The editor should expose a Connect MCP action with these states.

- Not configured. Show the endpoint URL and the `token` query parameter.
- Configured but unauthenticated. Show how to refresh or paste a new token.
- Connected. Show the active session, connected client count, and a revoke
  action.
- Multiple tabs open. Show Use this tab so the current tab is the active
  target.

MCP should default tool calls to the active editor session. Provide session
management tools for ambiguity.

- `list_sessions`
- `get_active_session`
- `select_session`

## Runtime flow

1. A user opens `https://app.mcut.io/editor`.
2. The editor calls the relay to create or resume a session.
3. The editor opens a WebSocket to the relay, for example
   `wss://app.mcut.io/bridge/sessions/:sessionId`.
4. The editor sends the existing live bridge `hello` message with tab metadata.
5. An MCP client connects to `https://app.mcut.io/mcp?token=<session-token>`
   using Streamable HTTP.
6. The client authenticates with the token query parameter and receives access
   scoped to that session.
7. An MCP tool call reaches the Worker, which routes it to the correct
   `SessionDurableObject`.
8. The Durable Object forwards the request to the active browser tab.
9. The browser executes the request against the live editor engine and returns
   the result.
10. The Durable Object returns the MCP response to the client.

The existing request types should remain the wire vocabulary between relay and
browser, including project context, transcript tools, actions, operators, raw
commands, undo, and redo.

## Durable Object responsibilities

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

Hosted clients authenticate with a session-scoped token on the MCP URL
(`?token=`).

Keep browser session auth separate from MCP client auth.

- Browser tabs authenticate to the relay with a session-scoped browser token.
- MCP clients authenticate with the token query parameter on the `/mcp` URL.
- The relay maps authenticated tokens to their active editor sessions.
- Session tokens are high entropy, scoped, revocable, and expire on inactivity.

Enforce transport protections.

- Use HTTPS and WSS in hosted environments.
- Validate `Origin` for browser WebSocket upgrades.
- Reject cross-origin browser RPC access unless explicitly allowed.
- Do not expose unauthenticated public listeners.
- Return a clear `browser-not-connected` style error when no active editor tab is
  connected.

The relay should never persist full project state or uploaded media in v1. That
keeps the privacy model aligned with browser-source editing.

## Fallbacks

Keep the current local bridge flows. mcut Studio hosts the bridge in the desktop
app on port `44737`, and the standalone process serves a browser tab:

```sh
bunx -p @mcut/mcp-server mcut-mcp-live
bunx -p @mcut/mcp-server mcut-bridge start
bunx -p @mcut/mcp-server mcut-bridge mcp
```

Use these for:

- The desktop app and local development.
- Offline workflows.
- Self-hosted editors without the hosted relay.
- Debugging remote relay issues.

The hosted Cloudflare relay should be the default documented path for
`app.mcut.io`, while the local bridge remains the escape hatch.

## Test plan

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
- Connect MCP UI reflects configured, authenticated, connected, and revoked
  states.
- Use this tab updates the active session.

Regression-test local fallback:

- Existing `mcut-mcp-live` tests continue to pass.
- Existing `mcut-bridge start` plus `mcut-bridge mcp` tests continue to pass.

## References

- Cursor MCP configuration for Streamable HTTP servers lives at
  https://cursor.com/docs/mcp
- Cloudflare Durable Objects support stateful WebSocket coordination and
  WebSocket Hibernation at
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
