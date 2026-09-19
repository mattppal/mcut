# Electron local MCP spike

Throwaway. Proves one MCP round trip through an Electron shell that hosts the
existing `LiveMcutBridge` in its main process and loads Studio in its renderer.
Nothing here is meant to merge. The write-up lives in the mcut dev project
store at `docs/electron-local-mcp-spike.md`.

```sh
bun install && bun run turbo run build --filter="mcut-studio-web^..."
bun run --cwd apps/studio dev -- --port 3000
cd spikes/electron-local-mcp && npm install && npx electron . --no-sandbox
bun spikes/electron-local-mcp/roundtrip.ts    # from the repo root
```

`roundtrip.ts` reads the MCP URL the app wrote to `/tmp/mcut-electron-mcp-url`,
calls the `addTrack` tool over Streamable HTTP, and prints `ROUNDTRIP PASS`
when the summary that comes back from the renderer contains the new track.
