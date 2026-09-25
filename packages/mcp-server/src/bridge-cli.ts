#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BRIDGE_PORT, LiveMcutBridge, bridgeRpcUrl, createHttpBridgeTarget, parseLiveBridgePort } from './live-bridge'
import { createMcutMcpServerForTarget } from './server'

interface ParsedArgs {
  command: string
  rest: string[]
  port: number
  token?: string
  json: unknown
  editorUrl: string
  allowedOrigins: string[]
}

function usage(): string {
  return [
    'Usage:',
    '  mcut-bridge start [--port 44737] [--token <token>] [--editor-url http://localhost:3000/editor] [--allow-origin https://mcut.com]',
    '  mcut-bridge status [--port 44737]',
    '  mcut-bridge url [--editor-url http://localhost:3000/editor] [--port 44737] [--token <token>]',
    '  mcut-bridge get-summary [--port 44737]',
    '  mcut-bridge get-project [--port 44737]',
    '  mcut-bridge get-media-context [--port 44737]',
    '  mcut-bridge get-transcript [--json \'{"includeWords":true}\'] [--port 44737]',
    '  mcut-bridge search-transcript <query> [--port 44737]',
    '  mcut-bridge ensure-transcript [--json \'{"elementId":"e-...","replace":false}\'] [--port 44737]',
    '  mcut-bridge list-actions [--port 44737]',
    "  mcut-bridge action <actionId> [--json '{...}'] [--port 44737]",
    "  mcut-bridge dispatch <commandName> [--json '{...}'] [--port 44737]",
    "  mcut-bridge operator <operatorId> [--json '{...}'] [--port 44737]",
    '  mcut-bridge undo [--port 44737]',
    '  mcut-bridge redo [--port 44737]',
    '  mcut-bridge mcp [--port 44737] [--token <token>]',
    '',
    'Every command except start, status, and url needs the bridge token, from --token or MCUT_BRIDGE_TOKEN.',
  ].join('\n')
}

function parseJson(value: string | undefined): unknown {
  if (!value) return {}
  return JSON.parse(value) as unknown
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? 'help'
  const rest: string[] = []
  let port = parseLiveBridgePort(process.env.MCUT_BRIDGE_PORT) ?? DEFAULT_BRIDGE_PORT
  let token = process.env.MCUT_BRIDGE_TOKEN || undefined
  let json: unknown = {}
  let editorUrl = 'http://localhost:3000/editor'
  const allowedOrigins: string[] = []

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg === '--port') {
      port = parseLiveBridgePort(argv[++i]) ?? DEFAULT_BRIDGE_PORT
    } else if (arg === '--token') {
      token = argv[++i]
    } else if (arg === '--json') {
      json = parseJson(argv[++i])
    } else if (arg === '--editor-url') {
      editorUrl = argv[++i] ?? editorUrl
    } else if (arg === '--allow-origin') {
      const origin = argv[++i]
      if (origin) allowedOrigins.push(origin)
    } else {
      rest.push(arg)
    }
  }

  return { command, rest, port, token, json, editorUrl, allowedOrigins }
}

async function rpc(args: ParsedArgs, type: string, payload: unknown = {}): Promise<unknown> {
  const response = await fetch(bridgeRpcUrl(args.port, args.token), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mcut-bridge-client': 'cli',
    },
    body: JSON.stringify({ type, payload }),
  })
  const json = (await response.json()) as { ok: boolean; result?: unknown; error?: string }
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? `mcut bridge request failed (${response.status})`)
  }
  return json.result
}

async function status(port: number): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/status`)
  const json = (await response.json()) as { ok: boolean; result?: unknown; error?: string }
  if (!response.ok || !json.ok) throw new Error(json.error ?? 'mcut bridge is not running.')
  return json.result
}

function editorUrl(base: string, port: number, token?: string | null): string {
  const url = new URL(base)
  url.searchParams.set('mcpBridge', String(port))
  if (token) url.searchParams.set('mcpToken', token)
  return url.toString()
}

function mcpUrl(port: number, token?: string | null): string {
  const url = new URL(`http://127.0.0.1:${port}/mcp`)
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch (error) {
    if (error instanceof TypeError) return null
    throw error
  }
}

function print(value: unknown): void {
  if (typeof value === 'string') {
    process.stdout.write(`${value}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${usage()}\n`)
      return
    case 'start': {
      const editorOrigin = originOf(args.editorUrl)
      const allowedOrigins = [...args.allowedOrigins, ...(editorOrigin ? [editorOrigin] : [])]
      const bridge = new LiveMcutBridge({ token: args.token, editorUrl: args.editorUrl, allowedOrigins })
      const port = await bridge.listen(args.port)
      process.stderr.write(`mcut bridge ready — ws://127.0.0.1:${port}/mcut-mcp\n`)
      process.stderr.write(`MCP URL: ${bridge.getMcpUrl() ?? mcpUrl(port, bridge.token)}\n`)
      process.stderr.write(`Editor URL: ${bridge.getOpenEditorUrl() ?? editorUrl(args.editorUrl, port, bridge.token)}\n`)
      process.stderr.write('Leave this process running while agents edit the browser project.\n')
      await new Promise<void>(() => {})
      return
    }
    case 'status':
      print(await status(args.port))
      return
    case 'url':
      process.stdout.write(`${editorUrl(args.editorUrl, args.port, args.token)}\n`)
      return
    case 'get-summary':
      print(await rpc(args, 'get_summary'))
      return
    case 'get-project':
      print(await rpc(args, 'get_project'))
      return
    case 'get-media-context':
      print(await rpc(args, 'get_media_context'))
      return
    case 'get-transcript':
      print(await rpc(args, 'get_transcript', args.json))
      return
    case 'search-transcript': {
      const query = args.rest.join(' ').trim()
      if (!query) throw new Error('search-transcript requires a query.')
      print(await rpc(args, 'search_transcript', { query }))
      return
    }
    case 'ensure-transcript':
      print(await rpc(args, 'ensure_transcript', args.json))
      return
    case 'list-actions':
      print(await rpc(args, 'list_actions'))
      return
    case 'action': {
      const actionId = args.rest[0]
      if (!actionId) throw new Error('action requires an action id.')
      print(await rpc(args, 'run_action', { actionId, input: args.json }))
      return
    }
    case 'dispatch': {
      const commandName = args.rest[0]
      if (!commandName) throw new Error('dispatch requires a command name.')
      print(await rpc(args, 'dispatch_command', { commandName, input: args.json }))
      return
    }
    case 'operator': {
      const operatorId = args.rest[0]
      if (!operatorId) throw new Error('operator requires an operator id.')
      print(await rpc(args, 'run_operator', { operatorId, input: args.json }))
      return
    }
    case 'undo':
      print(await rpc(args, 'undo'))
      return
    case 'redo':
      print(await rpc(args, 'redo'))
      return
    case 'mcp': {
      const server = createMcutMcpServerForTarget({
        target: createHttpBridgeTarget(args.port, args.token),
        name: 'mcut-bridge',
      })
      await server.connect(new StdioServerTransport())
      return
    }
    default:
      throw new Error(`Unknown mcut-bridge command "${args.command}".\n\n${usage()}`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
