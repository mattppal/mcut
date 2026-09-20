import {
  DESKTOP_INVOKES,
  invokeResultSchema,
  menuMessageSchema,
  updateStateSchema,
  type DesktopApi,
  type DesktopInvokeChannel,
  type DesktopResult,
  type MenuAction,
  type UpdateState,
} from '@mcut/desktop-ipc'
import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'

async function invoke<Output>(channel: DesktopInvokeChannel, output: z.ZodType<Output>, input: unknown): Promise<DesktopResult<Output>> {
  const raw: unknown = await ipcRenderer.invoke(channel, input)
  const parsed = invokeResultSchema(output).safeParse(raw)
  if (parsed.success) return parsed.data
  return { ok: false, error: { code: 'internal', message: `${channel} returned an unexpected result. ${z.prettifyError(parsed.error)}` } }
}

const menuListeners = new Set<(action: MenuAction) => void>()

ipcRenderer.on('menu', (_event, payload: unknown) => {
  const { action } = menuMessageSchema.parse(payload)
  for (const listener of menuListeners) listener(action)
})

const updateListeners = new Set<(state: UpdateState) => void>()
let lastUpdateState: UpdateState | undefined

ipcRenderer.on('update', (_event, payload: unknown) => {
  const state = updateStateSchema.parse(payload)
  lastUpdateState = state
  for (const listener of updateListeners) listener(state)
})

const api: DesktopApi = {
  version: 1,
  platform: process.platform === 'darwin' ? 'darwin' : 'linux',
  info: () => invoke('app.info', DESKTOP_INVOKES['app.info'].output, undefined),
  setTranscriptionKey: (key) => invoke('app.setTranscriptionKey', DESKTOP_INVOKES['app.setTranscriptionKey'].output, { key }),
  projects: {
    open: () => invoke('project.open', DESKTOP_INVOKES['project.open'].output, undefined),
    save: (input) => invoke('project.save', DESKTOP_INVOKES['project.save'].output, input),
  },
  onMenu: (callback) => {
    menuListeners.add(callback)
  },
  update: {
    download: () => invoke('update.download', DESKTOP_INVOKES['update.download'].output, undefined),
    install: () => invoke('update.install', DESKTOP_INVOKES['update.install'].output, undefined),
    onState: (callback) => {
      updateListeners.add(callback)
      if (lastUpdateState !== undefined) callback(lastUpdateState)
    },
  },
}

contextBridge.exposeInMainWorld('mcutDesktop', api)
