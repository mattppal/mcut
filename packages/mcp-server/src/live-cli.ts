#!/usr/bin/env node
/**
 * Live browser entry point:
 *
 *   mcut-mcp-live [--port 54319] [--editor-url http://localhost:3000/editor]
 *
 * Starts an MCP server over stdio and a localhost WebSocket bridge. Open the
 * printed editor URL so the browser tab becomes the source of truth.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { LiveMcutBridge, parseLiveBridgePort } from './live-bridge'
import { createMcutMcpServerForTarget } from './server'

interface Args {
  port?: number
  token?: string
  editorUrl: string
}

function readArgs(argv: string[]): Args {
  const args: Args = { editorUrl: 'http://localhost:3000/editor' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      args.port = parseLiveBridgePort(argv[++i])
    } else if (arg === '--token') {
      args.token = argv[++i]
    } else if (arg === '--editor-url') {
      args.editorUrl = argv[++i] ?? args.editorUrl
    } else if (arg === '--help' || arg === '-h') {
      console.error(
        [
          'Usage: mcut-mcp-live [--port 54319] [--editor-url http://localhost:3000/editor]',
          '',
          'Starts a stdio MCP server that forwards mcut tools to a live browser editor tab.',
        ].join('\n'),
      )
      process.exit(0)
    }
  }
  return args
}

function editorBridgeUrl(editorUrl: string, port: number, token: string): string {
  const url = new URL(editorUrl)
  url.searchParams.set('mcpBridge', String(port))
  url.searchParams.set('mcpToken', token)
  return url.toString()
}

const args = readArgs(process.argv.slice(2))
const bridge = new LiveMcutBridge({ token: args.token })
const port = await bridge.listen(args.port)

console.error(
  [
    `mcut live MCP server ready — bridge: ws://127.0.0.1:${port}/mcut-mcp`,
    `Open editor: ${editorBridgeUrl(args.editorUrl, port, bridge.token ?? '')}`,
    '',
    'MCP client config:',
    JSON.stringify(
      {
        mcpServers: {
          'mcut-live': {
            command: 'bunx',
            args: [
              '-p',
              '@mcut/mcp-server',
              'mcut-mcp-live',
              '--port',
              String(port),
              '--token',
              bridge.token ?? '',
              '--editor-url',
              args.editorUrl,
            ],
          },
        },
      },
      null,
      2,
    ),
  ].join('\n'),
)

const server = createMcutMcpServerForTarget({
  target: bridge.createTarget(),
  name: 'mcut-live',
})

process.on('SIGINT', () => {
  bridge.close()
  process.exit(130)
})
process.on('SIGTERM', () => {
  bridge.close()
  process.exit(143)
})

await server.connect(new StdioServerTransport())
