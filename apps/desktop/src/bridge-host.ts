import { LiveBridgeError, LiveMcutBridge } from '@mcut/mcp-server'
import type { BridgeConfig } from './bridge-config'

export interface BridgeHostOptions {
  editorUrl: string
  allowedOrigins: readonly string[]
}

export interface BridgeHost {
  bridge: LiveMcutBridge
  port: number
  mcpUrl: string
  editorUrl: string
}

export async function startBridge(config: BridgeConfig, options: BridgeHostOptions): Promise<BridgeHost> {
  const bridge = new LiveMcutBridge({
    token: config.token,
    editorUrl: options.editorUrl,
    allowedOrigins: [...options.allowedOrigins],
  })
  const port = await bridge.listen(config.port)
  const mcpUrl = bridge.getMcpUrl()
  const editorUrl = bridge.getOpenEditorUrl()
  if (mcpUrl === null || editorUrl === null) {
    bridge.close()
    throw new LiveBridgeError('invalid-listener', 'The live bridge is listening but reports no address.')
  }
  process.stdout.write(`BRIDGE_READY ws://127.0.0.1:${port}/mcut-mcp\n`)
  process.stdout.write(`MCP_URL ${mcpUrl}\n`)
  return { bridge, port, mcpUrl, editorUrl }
}
