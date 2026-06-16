---
title: Local bridge
description: Connect MCP clients and local scripts to a live browser editor tab.
---

The local bridge keeps the browser editor tab as the source of truth while agents
or scripts edit through MCP-style tools.

## Live MCP server

```sh
bunx -p @mcut/mcp-server mcut-mcp-live --port 54319 --editor-url http://localhost:3000/editor
```

This starts a stdio MCP server and a localhost WebSocket bridge. It prints an
editor URL with bridge parameters. Open that URL so the browser tab connects.

## Bridge server

```sh
bunx -p @mcut/mcp-server mcut-bridge start --port 44737 --editor-url http://localhost:3000/editor
```

The bridge server exposes local HTTP RPC and WebSocket endpoints for a connected
editor tab. Keep the process running while agents or scripts edit.

## Bridge MCP adapter

```sh
bunx -p @mcut/mcp-server mcut-bridge mcp --port 44737
```

This exposes the running bridge as an MCP stdio server.

## Utility commands

| Command | Purpose |
| --- | --- |
| `status` | Check whether the bridge is running and connected. |
| `url` | Print the editor URL for a bridge port. |
| `get-summary` | Print the live project summary. |
| `get-project` | Print the live project JSON. |
| `get-media-context` | Print live media and selection context. |
| `get-transcript` | Print caption-derived transcript data. |
| `search-transcript` | Search transcript text. |
| `ensure-transcript` | Trigger local browser transcription when available. |
| `list-actions` | List live browser editor actions. |
| `action` | Run a browser action by id. |
| `dispatch` | Dispatch a raw command. |
| `operator` | Run an editor operator by id. |
| `undo` | Undo in the live editor. |
| `redo` | Redo in the live editor. |

## When to use the bridge

Use the bridge when an edit needs browser-only capabilities, live editor state,
local Whisper transcription, or exact parity with a running editor tab. Use the
stdio project server when a project JSON file is enough.
