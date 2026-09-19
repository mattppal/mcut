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

export interface Downloads {
  next(timeoutMs: number): Promise<string>
}

interface DownloadItemLike {
  getFilename(): string
  setSavePath(target: string): void
  once(event: 'done', listener: (event: unknown, state: string) => void): void
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

export const test = base.extend<{ page: Page; downloads: Downloads }, { app: ElectronApplication; editorUrl: string }>({
  app: [
    async ({}, provide) => {
      const configHome = await mkdtemp(path.join(tmpdir(), 'mcut-e2e-'))
      const app = await _electron.launch({ ...launchTarget(), cwd: repoRoot, env: launchEnv(configHome), chromiumSandbox: true })
      const window = await app.firstWindow()
      await window.waitForURL(/^app:\/\/studio\/editor\?mcpBridge=\d+&mcpToken=[0-9a-f]{64}$/)
      const handle = await app.browserWindow(window)
      await handle.evaluate((browserWindow, size) => browserWindow.setContentSize(size.width, size.height), WINDOW)
      await provide(app)
      await app.close()
      await rm(configHome, { recursive: true, force: true })
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
      next: (timeoutMs) =>
        app.evaluate(
          ({ session }, options) =>
            new Promise<string>((resolve, reject) => {
              const onDownload = (_event: unknown, item: DownloadItemLike) => {
                clearTimeout(timer)
                session.defaultSession.off('will-download', onDownload)
                const target = `${options.dir}/${item.getFilename()}`
                item.setSavePath(target)
                item.once('done', (_done, state) => (state === 'completed' ? resolve(target) : reject(new Error(`download ${state}`))))
              }
              const timer = setTimeout(() => {
                session.defaultSession.off('will-download', onDownload)
                reject(new Error(`no download started within ${options.timeoutMs} ms`))
              }, options.timeoutMs)
              session.defaultSession.on('will-download', onDownload)
            }),
          { dir, timeoutMs },
        ),
    })
  },
})
