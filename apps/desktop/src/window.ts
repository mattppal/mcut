import path from 'node:path'
import { BrowserWindow, session } from 'electron'
import { openExternalLink } from './menu'

export interface EditorWindowOptions {
  url: string
  title: string
  allowedOrigins: readonly string[]
}

function isAllowedNavigation(url: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`))
}

export function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
}

export async function openEditorWindow(options: EditorWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: options.title,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, options.allowedOrigins)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url)
    return { action: 'deny' }
  })
  await window.loadURL(options.url)
  return window
}
