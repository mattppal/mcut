import { writeFileSync } from 'node:fs'
import { app, BrowserWindow } from 'electron'
import { LiveMcutBridge } from '@mcut/mcp-server'

const editorUrl = process.env.MCUT_EDITOR_URL ?? 'http://localhost:3000/editor'
const requestedPort = Number(process.env.MCUT_BRIDGE_PORT ?? 0)
const urlFile = process.env.MCUT_MCP_URL_FILE ?? '/tmp/mcut-electron-mcp-url'

const bridge = new LiveMcutBridge({
  token: process.env.MCUT_BRIDGE_TOKEN,
  editorUrl,
  allowedOrigins: [new URL(editorUrl).origin],
})

app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const port = await bridge.listen(requestedPort)
  const mcpUrl = bridge.getMcpUrl()
  writeFileSync(urlFile, `${mcpUrl}\n`)
  process.stdout.write(`MCP_URL ${mcpUrl}\n`)
  process.stdout.write(`BRIDGE ws://127.0.0.1:${port}/mcut-mcp\n`)

  const win = new BrowserWindow({ width: 1440, height: 900 })
  win.webContents.on('console-message', (_event, level, message) => {
    process.stdout.write(`RENDERER[${level}] ${message}\n`)
  })
  await win.loadURL(bridge.getOpenEditorUrl())
  process.stdout.write(`LOADED ${win.webContents.getURL()}\n`)
})

app.on('window-all-closed', () => {
  bridge.close()
  app.quit()
})
