import path from 'node:path'
import type { DesktopInfo, InvokeHandlers, UpdateState } from '@mcut/desktop-ipc'
import { LiveBridgeError } from '@mcut/mcp-server'
import { BrowserWindow, app, safeStorage, session } from 'electron'
import { parseLaunchOptions, resolveToken, type BridgeConfig, type LaunchOptions } from './bridge-config'
import { startBridge, type BridgeHost, type BridgeHostOptions } from './bridge-host'
import { registerDesktopIpc } from './ipc'
import { cursorInstallUrl, installAppMenu } from './menu'
import { projectHandlers } from './projects'
import { STUDIO_ORIGIN, registerStudioScheme, serveStudio } from './serve-studio'
import { openSettings, reportSafeStorageBackend, type DesktopSettings } from './settings'
import { handleTranscribeRequest } from './transcribe'
import { startUpdater, type UpdateHandlers } from './updater'
import { hardenSession, openEditorWindow } from './window'

const APP_TITLE = 'mcut Studio'

registerStudioScheme()
if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)

function allowedOrigins(options: LaunchOptions): string[] {
  return options.devUrl === undefined ? [STUDIO_ORIGIN] : [STUDIO_ORIGIN, options.devUrl.origin]
}

function bridgeHostOptions(options: LaunchOptions): BridgeHostOptions {
  const studioOrigin = options.devUrl?.origin ?? STUDIO_ORIGIN
  return { editorUrl: `${studioOrigin}/editor`, allowedOrigins: allowedOrigins(options) }
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

function broadcastUpdateState(state: UpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update', state)
}

function desktopHandlers(mcp: DesktopInfo['mcp'], settings: DesktopSettings, updates: UpdateHandlers): InvokeHandlers {
  return {
    ...projectHandlers,
    ...updates,
    'app.info': async () => ({
      appVersion: app.getVersion(),
      platform: process.platform === 'darwin' ? 'darwin' : 'linux',
      mcp,
      transcription: { configured: settings.transcriptionConfigured() },
    }),
    'app.setTranscriptionKey': async ({ key }) => ({ configured: settings.setTranscriptionKey(key) }),
  }
}

async function main(): Promise<void> {
  const options = parseLaunchOptions({ argv: process.argv, env: process.env })
  await app.whenReady()
  reportSafeStorageBackend()
  const settings = openSettings(path.join(app.getPath('userData'), 'settings.json'))
  serveStudio({ transcribe: (request) => handleTranscribeRequest(request, settings) })
  hardenSession(allowedOrigins(options))
  routeDownloadsToSaveDialog()
  const token = resolveToken(options.tokenSource, path.join(app.getPath('userData'), 'bridge-token'))
  const port = options.bridgePort === 'ephemeral' ? 0 : options.bridgePort
  const { host, title } = await hostBridge({ port, token }, bridgeHostOptions(options))
  const mcp = { url: host.mcpUrl, cursorInstallUrl: cursorInstallUrl(host.mcpUrl) }
  let updateState: UpdateState = { phase: 'idle' }
  const updates = startUpdater({
    feedUrl: options.updateFeedUrl,
    onState: (state) => {
      updateState = state
      broadcastUpdateState(state)
    },
  })
  registerDesktopIpc(desktopHandlers(mcp, settings, updates), { allowedOrigins: allowedOrigins(options) })
  installAppMenu({ mcp })
  app.on('window-all-closed', () => {
    host.bridge.close()
    app.quit()
  })
  const window = await openEditorWindow({ url: host.editorUrl, title, allowedOrigins: allowedOrigins(options) })
  window.webContents.send('update', updateState)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  app.exit(1)
})
