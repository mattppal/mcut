import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_BRIDGE_PORT } from '@mcut/mcp-server'
import { z } from 'zod'
import { bridgeTokenSchema } from '../src/bridge-config'

const USAGE = 'usage: bun apps/desktop/scripts/roundtrip.ts [mcpUrl]   (or set MCUT_BRIDGE_URL; defaults to port 44737 with the persisted desktop token)'

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})

function userDataDirectory(): string {
  const home = homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'mcut-desktop')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'mcut-desktop')
}

function persistedMcpUrl(): URL {
  const tokenFile = path.join(userDataDirectory(), 'bridge-token')
  if (!existsSync(tokenFile)) throw new Error(`${tokenFile} does not exist. Launch the desktop app once, or pass the MCP URL.\n${USAGE}`)
  const token = bridgeTokenSchema.parse(readFileSync(tokenFile, 'utf8').trim())
  const url = new URL(`http://127.0.0.1:${DEFAULT_BRIDGE_PORT}/mcp`)
  url.searchParams.set('token', token)
  return url
}

function resolveMcpUrl(argument: string | undefined): URL {
  const explicit = argument ?? process.env.MCUT_BRIDGE_URL
  return explicit === undefined || explicit.length === 0 ? persistedMcpUrl() : new URL(explicit)
}

async function main(): Promise<number> {
  const mcpUrl = resolveMcpUrl(process.argv[2])
  const status = await (await fetch(new URL('/status', mcpUrl))).json()
  console.log('STATUS', JSON.stringify(status))

  const client = new Client({ name: 'mcut-desktop-roundtrip', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(mcpUrl))
  try {
    const trackName = `From MCP via Electron ${Date.now()}`
    const started = performance.now()
    const result = toolResultSchema.parse(await client.callTool({ name: 'addTrack', arguments: { name: trackName } }))
    const elapsedMs = Math.round(performance.now() - started)
    console.log('RESULT', JSON.stringify(result))
    const text = result.content.map((block) => block.text ?? '').join('\n')
    const pass = result.isError !== true && text.includes(trackName)
    console.log(pass ? `ROUNDTRIP PASS ${elapsedMs}ms` : `ROUNDTRIP FAIL ${elapsedMs}ms`)
    return pass ? 0 : 1
  } finally {
    await client.close()
  }
}

process.exit(await main())
