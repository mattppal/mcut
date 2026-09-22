import { mkdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { z } from 'zod'
import type { Download, SurfaceContext, WhisperNetwork } from '../context.ts'
import type { Surface } from '../features.ts'
import type { OpenSurface, SurfaceHandle } from './handle.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const WINDOW = { width: 1600, height: 1000 }
const DEAD_UPDATE_FEED = 'http://127.0.0.1:9/'
const UPSTREAM_PATTERNS = ['*://huggingface.co/*', '*://*.hf.co/*', '*://cdn.jsdelivr.net/*']

type DownloadItemLike = {
  getFilename(): string
  setSavePath(target: string): void
  once(event: 'done', listener: (event: unknown, state: string) => void): void
}

const UPSTREAM_LOG = 'MCUT_SMOKE_UPSTREAM_LOG'

function launchEnv(configHome: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.XDG_CONFIG_HOME = configHome
  env.MCUT_UPDATE_FEED_URL = DEAD_UPDATE_FEED
  env.APPIMAGE_EXTRACT_AND_RUN = '1'
  return env
}

function target(surface: Surface, electronPath: string | null): { executablePath: string; args: string[] } {
  if (surface === 'installed') {
    if (electronPath === null) throw new Error('the installed surface needs --electron <binary> or MCUT_ELECTRON_PATH')
    return { executablePath: path.resolve(electronPath), args: ['--port', '0'] }
  }
  const electron = z.string().parse(createRequire(path.join(repoRoot, 'apps/desktop/package.json'))('electron'))
  return { executablePath: electron, args: ['apps/desktop', '--port', '0'] }
}

function hookUpstream(app: ElectronApplication, whisper: WhisperNetwork): Promise<void> {
  const mirror = whisper.mode === 'mirror' ? whisper.url : null
  return app.evaluate(
    ({ session }, options) => {
      process.env[options.logKey] = ''
      session.defaultSession.webRequest.onBeforeRequest({ urls: options.patterns }, (details, callback) => {
        process.env[options.logKey] = `${process.env[options.logKey] ?? ''}${details.url}\n`
        if (options.mirror === null) return callback({})
        callback({ redirectURL: `${options.mirror}${new URL(details.url).pathname}` })
      })
    },
    { patterns: UPSTREAM_PATTERNS, mirror, logKey: UPSTREAM_LOG },
  )
}

function drainUpstream(app: ElectronApplication): Promise<string[]> {
  return app.evaluate((_electron, logKey) => {
    const seen = (process.env[logKey] ?? '').split('\n').filter((line) => line.length > 0)
    process.env[logKey] = ''
    return seen
  }, UPSTREAM_LOG)
}

function nextDownload(app: ElectronApplication, dir: string, timeoutMs: number): Promise<string> {
  return app.evaluate(
    ({ session }, options) =>
      new Promise<string>((resolve, reject) => {
        const onDownload = (_event: unknown, item: DownloadItemLike) => {
          clearTimeout(timer)
          session.defaultSession.off('will-download', onDownload)
          const file = `${options.dir}/${item.getFilename()}`
          item.setSavePath(file)
          item.once('done', (_done, state) => (state === 'completed' ? resolve(file) : reject(new Error(`download ${state}`))))
        }
        const timer = setTimeout(() => {
          session.defaultSession.off('will-download', onDownload)
          reject(new Error(`no download started within ${options.timeoutMs} ms`))
        }, options.timeoutMs)
        session.defaultSession.on('will-download', onDownload)
      }),
    { dir, timeoutMs },
  )
}

function stubOpenDialog(app: ElectronApplication, file: string): Promise<void> {
  return app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, file)
}

function stubSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  return app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, file)
}

export function openElectron(surface: Surface): OpenSurface {
  return async (options): Promise<SurfaceHandle> => {
    const configHome = path.join(options.outDir, 'config')
    const downloadDir = path.join(options.outDir, 'downloads')
    await mkdir(configHome, { recursive: true })
    await mkdir(downloadDir, { recursive: true })
    const launch = target(surface, options.electronPath)
    const app = await _electron.launch({ ...launch, cwd: repoRoot, env: launchEnv(configHome), chromiumSandbox: true })
    const page: Page = await app.firstWindow()
    await page.waitForURL(/^app:\/\/studio\/editor\?/, { timeout: 60_000 })
    await (await app.browserWindow(page)).evaluate((browserWindow, size) => browserWindow.setContentSize(size.width, size.height), WINDOW)
    await hookUpstream(app, options.whisper)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const ctx: SurfaceContext = {
      surface,
      page,
      view: page,
      fixtures: options.fixtures,
      outDir: options.outDir,
      whisper: options.whisper,
      assemblyAiKey: options.assemblyAiKey,
      importFile: async (file) => {
        await page.locator('input[type="file"]').first().setInputFiles(file)
      },
      nextDownload: async (timeoutMs): Promise<Download> => {
        const file = await nextDownload(app, downloadDir, timeoutMs)
        return { path: file, bytes: (await stat(file)).size }
      },
      stubOpenDialog: (file) => stubOpenDialog(app, file),
      stubSaveDialog: (file) => stubSaveDialog(app, file),
      upstreamRequests: () => drainUpstream(app),
      log: options.log,
    }
    return {
      ctx,
      target: `${launch.executablePath} ${launch.args.join(' ')}`,
      pageErrors,
      close: () => app.close(),
    }
  }
}
