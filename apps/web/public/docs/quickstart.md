---
title: Quickstart
description: Create a project document and expose it to an MCP client.
---

## Install and inspect the CLI

```sh
bunx @mcut/cli --help
```

The CLI works on mcut project JSON files. It can scaffold, validate, summarize,
lint, and batch-edit those files without a browser.

## Create a project

```sh
bunx @mcut/cli new project.mcut.json
bunx @mcut/cli summarize project.mcut.json
```

Use `summarize` before and after edits. The summary is the compact text view that
agents also receive from the MCP `get_summary` tool.

## Connect an MCP client to a project file

```json
{
  "mcpServers": {
    "mcut": {
      "command": "bunx",
      "args": ["@mcut/mcp-server", "project.mcut.json"]
    }
  }
}
```

The stdio MCP server creates the project file when missing and rewrites it after
successful edits.

## Connect to a live browser editor

Use the live bridge when the browser tab should remain the source of truth:

```sh
bunx -p @mcut/mcp-server mcut-mcp-live --editor-url http://localhost:3000/editor
```

The command prints an editor URL with bridge query parameters and an MCP client
configuration block. Keep the process running while the agent edits.

For lower-level local bridge control, use:

```sh
bunx -p @mcut/mcp-server mcut-bridge start --editor-url http://localhost:3000/editor
bunx -p @mcut/mcp-server mcut-bridge mcp
```

## Next steps

- Use [agent instructions](/docs/agent-instructions) as the system prompt or project note for agents.
- Use [commands](/docs/reference/commands) when you need exact project mutations.
- Use [operators](/docs/reference/operators) when you want UI-parity actions.
