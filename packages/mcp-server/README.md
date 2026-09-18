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

From the mcut repo root, `bun run dev` starts Studio and the local bridge and
prints the Streamable HTTP MCP URL. That URL is
`http://127.0.0.1:<port>/mcp?token=<token>`. The default port is `44737` and the
default token is `mcut-local-dev`. Print the URL again with
`bun run scripts/mcut-local-dev.ts mcp-url`.

Point any MCP client that supports Streamable HTTP at that URL. In Cursor, add
it to `mcp.json`.

```json
{
  "mcpServers": {
    "mcut": {
      "url": "http://127.0.0.1:44737/mcp?token=mcut-local-dev"
    }
  }
}
```

To start only the published bridge:

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
