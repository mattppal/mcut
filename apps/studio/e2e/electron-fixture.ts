import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { z } from 'zod'

export { expect } from '@playwright/test'
export type { Locator, Page } from '@playwright/test'

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const WINDOW = { width: 1600, height: 1000 }
const EDITOR_URL = /^app:\/\/studio\/editor\?mcpBridge=\d+&mcpToken=[0-9a-f]{64}$/
const EDITOR_URL_TIMEOUT_MS = 30_000

interface DownloadWait {
  file: Promise<string>
  cancel(): Promise<void>
}

export interface Downloads {
  next(timeoutMs: number): Promise<DownloadWait>
}

interface DownloadItemLike {
  getFilename(): string
  setSavePath(target: string): void
  once(event: 'done', listener: (event: unknown, state: string) => void): void
}

type DownloadOutcome = { kind: 'saved'; target: string } | { kind: 'missed'; reason: string }

interface PendingDownload {
  outcome: Promise<DownloadOutcome>
  cancel(): void
}

function launchEnv(configHome: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.XDG_CONFIG_HOME = configHome
  return env
}

function launchTarget(): { executablePath: string; args: string[] } {
  const packaged = process.env.MCUT_ELECTRON_PATH
  if (packaged) return { executablePath: path.resolve(repoRoot, packaged), args: ['--port', '0'] }
  const electron = z.string().parse(createRequire(path.join(repoRoot, 'apps/desktop/package.json'))('electron'))
  return { executablePath: electron, args: ['apps/desktop', '--port', '0'] }
}

async function waitForEditorUrl(window: Page): Promise<void> {
  try {
    await window.waitForURL(EDITOR_URL, { timeout: EDITOR_URL_TIMEOUT_MS })
  } catch (error) {
    throw new Error(`Studio did not open the editor with an mcpToken within ${EDITOR_URL_TIMEOUT_MS} ms, the window URL is ${window.url()}`, {
      cause: error,
    })
  }
}

async function closeApp(app: ElectronApplication | null, configHome: string): Promise<void> {
  try {
    await app?.close()
  } finally {
    await rm(configHome, { recursive: true, force: true })
  }
}

export const test = base.extend<{ page: Page; downloads: Downloads }, { app: ElectronApplication; editorUrl: string }>({
  app: [
    async ({}, provide) => {
      const configHome = await mkdtemp(path.join(tmpdir(), 'mcut-e2e-'))
      let app: ElectronApplication | null = null
      try {
        app = await _electron.launch({ ...launchTarget(), cwd: repoRoot, env: launchEnv(configHome), chromiumSandbox: true })
        const window = await app.firstWindow()
        await waitForEditorUrl(window)
        const handle = await app.browserWindow(window)
        await handle.evaluate((browserWindow, size) => browserWindow.setContentSize(size.width, size.height), WINDOW)
        await provide(app)
      } finally {
        await closeApp(app, configHome)
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  editorUrl: [async ({ app }, provide) => provide((await app.firstWindow()).url()), { scope: 'worker', auto: true }],
  page: async ({ app }, provide, testInfo) => {
    const page = await app.firstWindow()
    await app.evaluate(({ session }) => session.defaultSession.clearStorageData())
    await app.context().tracing.start({ screenshots: true, snapshots: true })
    await provide(page)
    const failed = testInfo.status !== testInfo.expectedStatus
    await app.context().tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : {})
  },
  downloads: async ({ app }, provide, testInfo) => {
    const dir = testInfo.outputPath('downloads')
    await mkdir(dir, { recursive: true })
    await provide({
      next: async (timeoutMs) => {
        const pending = await app.evaluateHandle(
          ({ session }, options): PendingDownload => {
            const { promise: outcome, resolve } = Promise.withResolvers<DownloadOutcome>()
            const onDownload = (_event: unknown, item: DownloadItemLike) => {
              unhook()
              const target = `${options.dir}/${item.getFilename()}`
              item.setSavePath(target)
              item.once('done', (_done, state) => resolve(state === 'completed' ? { kind: 'saved', target } : { kind: 'missed', reason: `download ${state}` }))
            }
            const missed = (reason: string) => {
              unhook()
              resolve({ kind: 'missed', reason })
            }
            const timer = setTimeout(() => missed(`no download started within ${options.timeoutMs} ms`), options.timeoutMs)
            const unhook = () => {
              clearTimeout(timer)
              session.defaultSession.off('will-download', onDownload)
            }
            session.defaultSession.on('will-download', onDownload)
            return { outcome, cancel: () => missed('download wait cancelled') }
          },
          { dir, timeoutMs },
        )
        let settled = false
        const file = pending
          .evaluate((download) => download.outcome)
          .then((outcome) => {
            if (outcome.kind === 'missed') throw new Error(outcome.reason)
            return outcome.target
          })
          .finally(() => {
            settled = true
            return pending.dispose()
          })
        return {
          file,
          cancel: async () => {
            if (!settled) await pending.evaluate((download) => download.cancel())
          },
        }
      },
    })
  },
})
