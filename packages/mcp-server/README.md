# @mcut/mcp-server

MCP server and local browser bridge for mcut.

This package exposes mcut commands and editor operators as Model Context
Protocol tools. It also includes a local HTTP bridge for connecting MCP clients
to a live browser editor session.

## Entrypoints

| Command | Use it for | Source of truth |
| --- | --- | --- |
| `mcut-bridge start` | Persistent local bridge. It exposes Streamable HTTP MCP at `/mcp` and browser sync at `/mcut-mcp`. | The connected Studio browser tab. |
| `mcut-mcp [project.mcut.json]` | File-backed stdio MCP server for headless edits. | The JSON project file on disk. |
| `mcut-mcp-live [--editor-url http://localhost:3000/editor]` | Compatibility stdio MCP server that starts its own live bridge and prints the editor URL to open. | The connected Studio browser tab. |
| `mcut-bridge mcp` | Compatibility stdio adapter for clients that cannot connect to the bridge over HTTP. | The connected Studio browser tab. |

## File-backed MCP

```sh
bunx -p @mcut/mcp-server mcut-mcp project.mcut.json
```

## Live bridge

For the primary live workflow, start the bridge and configure your MCP client to
use the printed `http://127.0.0.1:<port>/mcp` URL:

```sh
bunx -p @mcut/mcp-server mcut-bridge start --editor-url http://localhost:3000/editor
```

Open the editor URL printed by the bridge before running tools that need the
browser project.

For one compatibility process that starts stdio MCP and a bridge:

```sh
bunx -p @mcut/mcp-server mcut-mcp-live --editor-url http://localhost:3000/editor
```

For a compatibility stdio adapter attached to an already running bridge:

```sh
bunx -p @mcut/mcp-server mcut-bridge mcp
```
