import type { DesktopInfo, MenuAction } from '@mcut/desktop-ipc'
import { BrowserWindow, Menu, clipboard, shell, type MenuItemConstructorOptions } from 'electron'

export interface AppMenuOptions {
  mcp: DesktopInfo['mcp']
}

const EXTERNAL_LINK_PROTOCOLS = new Set(['cursor:', 'https:'])

export function openExternalLink(url: string): boolean {
  if (!URL.canParse(url) || !EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol)) return false
  void shell.openExternal(url)
  return true
}

export function cursorInstallUrl(mcpUrl: string): string {
  const url = new URL('cursor://anysphere.cursor-deeplink/mcp/install')
  url.searchParams.set('name', 'mcut')
  url.searchParams.set('config', Buffer.from(JSON.stringify({ url: mcpUrl })).toString('base64'))
  return url.toString()
}

function sendMenuAction(action: MenuAction): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send('menu', { action })
}

function menuActionItem(id: MenuAction, label: string, accelerator?: string): MenuItemConstructorOptions {
  const shortcut = accelerator === undefined ? {} : { accelerator, registerAccelerator: false }
  return { id, label, ...shortcut, click: () => sendMenuAction(id) }
}

export function installAppMenu(options: AppMenuOptions): void {
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      menuActionItem('project.open', 'Open project…', 'CmdOrCtrl+O'),
      menuActionItem('project.save', 'Save project', 'CmdOrCtrl+Shift+S'),
      menuActionItem('project.saveAs', 'Save project as…'),
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ],
  }
  const mcp: MenuItemConstructorOptions = {
    label: 'MCP',
    submenu: [
      { id: 'mcp.copyUrl', label: 'Copy MCP URL', click: () => clipboard.writeText(options.mcp.url) },
      { id: 'mcp.addToCursor', label: 'Add to Cursor', click: () => void openExternalLink(options.mcp.cursorInstallUrl) },
    ],
  }
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } satisfies MenuItemConstructorOptions] : []),
    file,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    mcp,
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
