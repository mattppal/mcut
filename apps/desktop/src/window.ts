import path from 'node:path'
import { BrowserWindow, session, type BrowserWindowConstructorOptions } from 'electron'
import { openExternalLink } from './menu'

export interface EditorWindowOptions {
  url: string
  title: string
  allowedOrigins: readonly string[]
}

function isAllowedNavigation(url: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((origin) => url === origin || url.startsWith(`${origin}/`))
}

const STUDIO_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-read', 'clipboard-sanitized-write'])

export function hardenSession(allowedOrigins: readonly string[]): void {
  const isStudioPermission = (permission: string, url: string) => STUDIO_PERMISSIONS.has(permission) && isAllowedNavigation(url, allowedOrigins)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) =>
    callback(isStudioPermission(permission, details.requestingUrl)),
  )
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => isStudioPermission(permission, requestingOrigin))
}

const STUDIO_DARK_BACKGROUND = '#0d0b09'
const STUDIO_DARK_FOREGROUND = '#cecdc3'
const HEADER_HEIGHT = 40

function chromeOptions(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 14 } }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: STUDIO_DARK_BACKGROUND, symbolColor: STUDIO_DARK_FOREGROUND, height: HEADER_HEIGHT },
  }
}

export async function openEditorWindow(options: EditorWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: options.title,
    backgroundColor: STUDIO_DARK_BACKGROUND,
    ...chromeOptions(),
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
