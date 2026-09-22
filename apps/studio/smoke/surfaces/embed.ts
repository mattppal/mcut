import { createReadStream, existsSync, statSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'
import type { Download, SurfaceContext, WhisperNetwork } from '../context.ts'
import { isUpstreamUrl } from '../whisper.ts'
import type { OpenSurface, SurfaceHandle } from './handle.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const WEB_OUT = path.join(repoRoot, 'apps/web/out')
const STUDIO_OUT = path.join(repoRoot, 'apps/studio/out')
const FIXTURES = path.join(repoRoot, 'apps/studio/e2e/fixtures')
const VIEWPORT = { width: 1600, height: 1000 }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function siteRoot(): string {
  if (existsSync(path.join(WEB_OUT, 'embed.html'))) return WEB_OUT
  if (existsSync(path.join(STUDIO_OUT, 'embed.html'))) return STUDIO_OUT
  throw new Error(`no static export at ${WEB_OUT} or ${STUDIO_OUT}, run bun run build first`)
}

function resolveFile(root: string, pathname: string): string | undefined {
  if (pathname.startsWith('/fixtures/')) {
    const file = path.join(FIXTURES, pathname.slice('/fixtures/'.length))
    return file.startsWith(FIXTURES) && existsSync(file) ? file : undefined
  }
  const candidates = pathname === '/' ? ['index.html'] : [pathname.slice(1), `${pathname.slice(1)}.html`]
  return candidates.map((candidate) => path.join(root, candidate)).find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
}

function serve(root: string): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname)
    const file = resolveFile(root, pathname)
    if (file === undefined) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size })
    createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('site server did not bind a port')
      resolve({ url: `http://127.0.0.1:${address.port}`, server })
    })
  })
}

async function routeUpstream(page: Page, whisper: WhisperNetwork, upstream: string[]): Promise<void> {
  page.on('request', (request) => {
    if (isUpstreamUrl(request.url())) upstream.push(request.url())
  })
  if (whisper.mode !== 'mirror') return
  const mirror = whisper.url
  await page.route(
    (url) => isUpstreamUrl(url.href),
    async (route) => {
      const response = await route.fetch({ url: `${mirror}${new URL(route.request().url()).pathname}` })
      return route.fulfill({ response })
    },
  )
}

export const openEmbed: OpenSurface = async (options): Promise<SurfaceHandle> => {
  const root = siteRoot()
  const site = await serve(root)
  const executablePath = process.env.MCUT_CHROME_PATH
  const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {})
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true })
  const page = await context.newPage()
  const upstream: string[] = []
  await routeUpstream(page, options.whisper, upstream)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const clip = `/fixtures/${path.basename(options.fixtures.clip)}`
  await page.goto(`${site.url}/embed?clip=${encodeURIComponent(clip)}&muted=1`, { waitUntil: 'networkidle' })

  const downloadDir = path.join(options.outDir, 'downloads')
  await mkdir(downloadDir, { recursive: true })

  const ctx: SurfaceContext = {
    surface: 'embed',
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
      const download = await page.waitForEvent('download', { timeout: timeoutMs })
      const target = path.join(downloadDir, download.suggestedFilename())
      const source = await download.path()
      await copyFile(source, target)
      return { path: target, bytes: statSync(target).size }
    },
    stubOpenDialog: async (file) => {
      page.once('filechooser', (chooser) => {
        void chooser.setFiles(file)
      })
    },
    stubSaveDialog: async () => {},
    upstreamRequests: async () => upstream.splice(0, upstream.length),
    log: options.log,
  }
  return {
    ctx,
    target: `${root} served at ${site.url}${executablePath ? `, browser ${executablePath}` : ', Playwright Chromium'}`,
    pageErrors,
    close: async () => {
      await browser.close()
      await new Promise<void>((resolve) => site.server.close(() => resolve()))
    },
  }
}
