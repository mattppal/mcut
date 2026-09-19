import path from 'node:path'
import { BrowserWindow } from 'electron'

export interface EditorWindowOptions {
  url: string
  title: string
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
  await window.loadURL(options.url)
  return window
}
