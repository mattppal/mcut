import path from 'node:path'
import { LiveBridgeError } from '@mcut/mcp-server'
import { app, session } from 'electron'
import { parseLaunchOptions, resolveToken, type BridgeConfig, type LaunchOptions } from './bridge-config'
import { startBridge, type BridgeHost, type BridgeHostOptions } from './bridge-host'
import { STUDIO_ORIGIN, registerStudioScheme, serveStudio } from './serve-studio'
import { openEditorWindow } from './window'

const APP_TITLE = 'mcut Studio'

registerStudioScheme()

function bridgeHostOptions(options: LaunchOptions): BridgeHostOptions {
  const studioOrigin = options.devUrl?.origin ?? STUDIO_ORIGIN
  return {
    editorUrl: `${studioOrigin}/editor`,
    allowedOrigins: options.devUrl === undefined ? [STUDIO_ORIGIN] : [STUDIO_ORIGIN, options.devUrl.origin],
  }
}

async function hostBridge(config: BridgeConfig, options: BridgeHostOptions): Promise<{ host: BridgeHost; title: string }> {
  try {
    return { host: await startBridge(config, options), title: APP_TITLE }
  } catch (error) {
    if (!(error instanceof LiveBridgeError) || error.code !== 'port-in-use') throw error
    process.stderr.write(`${error.message}\nFalling back to an ephemeral bridge port.\n`)
    const host = await startBridge({ ...config, port: 0 }, options)
    return { host, title: `${APP_TITLE} (MCP ${host.mcpUrl})` }
  }
}

function routeDownloadsToSaveDialog(): void {
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) })
  })
}

async function main(): Promise<void> {
  const options = parseLaunchOptions({ argv: process.argv, env: process.env })
  await app.whenReady()
  serveStudio()
  routeDownloadsToSaveDialog()
  const token = resolveToken(options.tokenSource, path.join(app.getPath('userData'), 'bridge-token'))
  const port = options.bridgePort === 'ephemeral' ? 0 : options.bridgePort
  const { host, title } = await hostBridge({ port, token }, bridgeHostOptions(options))
  app.on('window-all-closed', () => {
    host.bridge.close()
    app.quit()
  })
  await openEditorWindow({ url: host.editorUrl, title })
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  app.exit(1)
})
