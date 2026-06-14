# mcut MCP server

Every mcut edit is a zod-validated command through one registry — so exposing the whole
editor to any MCP client is a `listCommands()` loop. This example serves the registry
over stdio: each command becomes an MCP tool (its zod payload schema becomes the tool's
input schema), plus `get_summary`, `get_project`, `undo`, and `redo`.

The server reads and writes one project JSON file. Export stays in the browser
(WebCodecs); this server edits the document an editor UI can open.

## Run

```sh
bun run index.ts path/to/project.json   # created if missing
```

## Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "mcut": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/examples/mcp-server/index.ts", "/absolute/path/to/project.json"]
    }
  }
}
```

Then ask the agent things like:

> Add a title that says "Launch day", fade it in over 600ms, and speed the main clip up 2x.

The agent reads `get_summary`, dispatches `addElement`, `applyAnimationPreset`,
`setElementSpeed`, … and every successful call returns the refreshed summary as its
feedback loop. Custom commands registered with `registerCommand()` appear as tools
automatically.
