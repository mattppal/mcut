import { execFile } from 'node:child_process'
import path from 'node:path'
import type { InvokeHandlers, UpdateState } from '@mcut/desktop-ipc'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { resolveDesktopRelease } from './update-feed'

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const IDLE: UpdateState = { phase: 'idle' }

export type UpdateHandlers = Pick<InvokeHandlers, 'update.download' | 'update.install'>

export interface UpdaterOptions {
  feedUrl: URL | undefined
  onState: (state: UpdateState) => void
}

const idleHandlers: UpdateHandlers = {
  'update.download': async () => IDLE,
  'update.install': async () => IDLE,
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: unknown): void {
  process.stderr.write(`updater ${describe(message)}\n`)
}

function adHocSigned(): Promise<boolean> {
  const bundle = path.resolve(process.resourcesPath, '..', '..')
  return new Promise((resolve) => {
    execFile('codesign', ['-dv', bundle], (error, _stdout, stderr) => resolve(error !== null || stderr.includes('Signature=adhoc')))
  })
}

export function startUpdater(options: UpdaterOptions): UpdateHandlers {
  if (!app.isPackaged) {
    process.stderr.write('Auto-update is off in an unpackaged build.\n')
    return idleHandlers
  }
  let current: UpdateState = IDLE
  let notes: string | null = null
  const set = (next: UpdateState): void => {
    current = next
    options.onState(next)
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: log, warn: log, error: log, debug: log }
  autoUpdater.on('update-not-available', () => set(IDLE))
  autoUpdater.on('update-available', (info) => set({ phase: 'available', version: info.version, notes }))
  autoUpdater.on('download-progress', (progress) => {
    if (current.phase === 'downloading') set({ ...current, percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (event) => set({ phase: 'ready', version: event.version }))
  autoUpdater.on('error', (error) => {
    if (current.phase === 'downloading') set({ phase: 'failed', version: current.version, message: error.message })
  })

  const check = async (): Promise<void> => {
    const feed = options.feedUrl === undefined ? await resolveDesktopRelease(app.getVersion()) : { url: options.feedUrl.href, notes: null }
    if (feed === undefined) {
      log('no desktop release is published yet')
      return
    }
    notes = feed.notes
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.url })
    await autoUpdater.checkForUpdates()
  }
  const runCheck = (): void => {
    check().catch((error: unknown) => log(`check failed. ${describe(error)}`))
  }
  const start = (): void => {
    runCheck()
    setInterval(() => {
      if (current.phase !== 'downloading' && current.phase !== 'ready') runCheck()
    }, CHECK_INTERVAL_MS)
  }

  if (process.platform === 'darwin') {
    void adHocSigned().then((adhoc) => {
      if (adhoc) process.stderr.write('Auto-update is off. This macOS build is ad-hoc signed and Squirrel.Mac only installs Developer ID signed apps.\n')
      else start()
    })
  } else {
    start()
  }

  return {
    'update.download': async () => {
      if (current.phase !== 'available' && current.phase !== 'failed') return current
      set({ phase: 'downloading', version: current.version, percent: 0 })
      autoUpdater.downloadUpdate().catch((error: unknown) => log(`download failed. ${describe(error)}`))
      return current
    },
    'update.install': async () => {
      if (current.phase === 'ready') autoUpdater.quitAndInstall()
      return current
    },
  }
}
