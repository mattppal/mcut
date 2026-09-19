import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const mcpUrl = new URL(process.argv[2] ?? readFileSync('/tmp/mcut-electron-mcp-url', 'utf8').trim())

const status = await (await fetch(new URL('/status', mcpUrl))).json()
console.log('STATUS', JSON.stringify(status))

const client = new Client({ name: 'mcut-electron-spike', version: '0.0.0' })
await client.connect(new StreamableHTTPClientTransport(mcpUrl))

const trackName = `From MCP via Electron ${Date.now()}`
const started = performance.now()
const result = await client.callTool({ name: 'addTrack', arguments: { name: trackName } })
const elapsedMs = Math.round(performance.now() - started)
console.log('RESULT', JSON.stringify(result))

const text = JSON.stringify(result)
const pass = !(result as { isError?: boolean }).isError && text.includes(trackName)
console.log(pass ? `ROUNDTRIP PASS ${elapsedMs}ms` : `ROUNDTRIP FAIL ${elapsedMs}ms`)
await client.close()
process.exit(pass ? 0 : 1)
