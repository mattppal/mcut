import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron, chromium, expect, test, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test'
import { z } from 'zod'
import { EMBED_OMISSIONS, type EmbedOmission } from '../registry/mcut/embed'
import { captureConfig, captureSurface, comparePixels, type SurfaceCapture } from '../scripts/embed-parity-capture'
import { classify, diffCaptures, renderReport, type Difference } from '../scripts/embed-parity-report'

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const siteOut = path.join(repoRoot, 'apps/web/out')
const sampleClip = path.join(repoRoot, 'apps/web/public/demo/sample.mp4')
const reportDir = path.join(repoRoot, 'apps/studio/reports/embed-parity')
interface Size {
  width: number
  height: number
}

const FRAME: Size = { width: 1280, height: 720 }
const LEFT_TABS = ['media', 'text', 'animate', 'captions', 'transcript']
const PIXEL_THRESHOLD = 24
const MAX_PIXEL_MISMATCH = 0.03
const CAPTURE = captureConfig(EMBED_OMISSIONS)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function serveSite(): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname)
    const candidates = pathname === '/' ? ['index.html'] : [pathname.slice(1), `${pathname.slice(1)}.html`]
    const file = candidates.map((candidate) => path.join(siteOut, candidate)).find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep))
    if (file === undefined || !existsSync(file) || path.extname(file) === '') {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
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

async function startDisplay(): Promise<{ display: string | undefined; stop(): void }> {
  if (process.platform !== 'linux' || process.env.DISPLAY) return { display: process.env.DISPLAY, stop: () => {} }
  const display = ':99'
  const xvfb: ChildProcess = spawn('Xvfb', [display, '-screen', '0', '1600x1000x24'], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 800))
  if (xvfb.exitCode !== null) throw new Error('Xvfb exited, install xvfb or set DISPLAY')
  return { display, stop: () => xvfb.kill() }
}

function electronEnv(configHome: string, display: string | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  env.XDG_CONFIG_HOME = configHome
  if (display) env.DISPLAY = display
  return env
}

async function launchDesktop(display: string | undefined): Promise<{ app: ElectronApplication; page: Page; configHome: string; inner: Size }> {
  const configHome = await mkdtemp(path.join(tmpdir(), 'mcut-parity-'))
  const electron = z.string().parse(createRequire(path.join(repoRoot, 'apps/desktop/package.json'))('electron'))
  const app = await _electron.launch({
    executablePath: electron,
    args: ['apps/desktop', '--port', '0', '--no-sandbox', '--force-device-scale-factor=1'],
    cwd: repoRoot,
    env: electronEnv(configHome, display),
  })
  const page = await app.firstWindow()
  await page.waitForURL(/^app:\/\/studio\/editor\?/, { timeout: 30_000 })
  const handle = await app.browserWindow(page)
  await page.locator('[data-slot="editor-toolbar"]').waitFor()
  await handle.evaluate((browserWindow, size) => browserWindow.setContentSize(size.width, size.height), FRAME)
  await page.waitForTimeout(500)
  const inner = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  await page
    .getByText('Discard')
    .click({ timeout: 1500 })
    .catch(() => {})
  await page.setInputFiles('input[type="file"]', sampleClip)
  await page.getByTitle(/sample\.mp4/).dblclick()
  await page.locator('[data-mcut-clip]').waitFor()
  await page.locator('[title="Mute track"]').click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Escape')
  return { app, page, configHome, inner }
}

async function openEmbed(
  siteUrl: string,
  target: Size,
): Promise<{ browser: Awaited<ReturnType<typeof chromium.launch>>; page: Page; frame: Frame; iframe: Locator }> {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: FRAME.width, height: FRAME.height + 200 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${siteUrl}/`)
  await page.getByRole('button', { name: 'Take over the editor' }).click()
  const iframe = page.locator('iframe[title="mcut Studio"]')
  await iframe.waitFor()
  const frame = await (await iframe.elementHandle())?.contentFrame()
  if (!frame) throw new Error('the hero iframe has no content frame')
  await frame.locator('[data-mcut-clip]').waitFor({ timeout: 30_000 })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const box = await iframe.boundingBox()
    if (box === null) throw new Error('the hero iframe has no box')
    if (Math.round(box.width) === target.width && Math.round(box.height) === target.height) break
    const viewport = page.viewportSize() ?? { width: FRAME.width, height: FRAME.height + 200 }
    await page.setViewportSize({
      width: viewport.width + target.width - Math.round(box.width),
      height: viewport.height + target.height - Math.round(box.height),
    })
    await page.waitForTimeout(500)
  }
  await frame.locator('[data-slot="editor-toolbar"]').waitFor()
  return { browser, page, frame, iframe }
}

async function settle(surface: Page | Frame): Promise<void> {
  await surface.locator('[data-mcut-player]').hover()
  await surface.locator('section[aria-label^="Notifications"] li').first().waitFor({ state: 'detached', timeout: 15_000 })
  await surface.waitForTimeout(400)
}

async function captureTabs(surface: Page | Frame): Promise<Record<string, SurfaceCapture>> {
  const captures: Record<string, SurfaceCapture> = {}
  for (const tab of LEFT_TABS) {
    const button = surface.locator(`[data-rail-tab="${tab}"]`)
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
    await settle(surface)
    captures[tab] = await surface.evaluate(captureSurface, CAPTURE)
  }
  await surface.locator('[data-rail-tab="media"]').click()
  await settle(surface)
  return captures
}

async function withBrowserChrome<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const native = await page.evaluate(() => {
    const value = document.documentElement.getAttribute('data-window-chrome')
    document.documentElement.setAttribute('data-window-chrome', 'browser')
    return value
  })
  try {
    return await run()
  } finally {
    await page.evaluate((value) => {
      if (value === null) document.documentElement.removeAttribute('data-window-chrome')
      else document.documentElement.setAttribute('data-window-chrome', value)
    }, native)
  }
}

test('the homepage embed matches the desktop editor', async () => {
  test.setTimeout(240_000)
  expect(existsSync(path.join(siteOut, 'embed.html')), 'apps/web/out is built').toBe(true)
  expect(existsSync(path.join(repoRoot, 'apps/desktop/dist/main.mjs')), 'apps/desktop/dist is built').toBe(true)
  await rm(reportDir, { recursive: true, force: true })
  await mkdir(reportDir, { recursive: true })

  const site = await serveSite()
  const display = await startDisplay()
  let desktop: Awaited<ReturnType<typeof launchDesktop>> | null = null
  let embed: Awaited<ReturnType<typeof openEmbed>> | null = null
  try {
    desktop = await launchDesktop(display.display)
    embed = await openEmbed(site.url, desktop.inner)

    const desktopPage = desktop.page
    await settle(desktopPage)
    const desktopClip = { x: 0, y: 0, width: desktop.inner.width, height: desktop.inner.height }
    const desktopNativePng = await desktopPage.screenshot({ clip: desktopClip })
    const desktopNative = await desktopPage.evaluate(captureSurface, CAPTURE)
    const { desktopTabs, desktopPng } = await withBrowserChrome(desktopPage, async () => {
      const desktopTabs = await captureTabs(desktopPage)
      await settle(desktopPage)
      return { desktopTabs, desktopPng: await desktopPage.screenshot({ clip: desktopClip }) }
    })
    const embedTabs = await captureTabs(embed.frame)
    await settle(embed.frame)
    const iframeBox = await embed.iframe.boundingBox()
    if (iframeBox === null) throw new Error('the hero iframe has no box')
    const embedPng = await embed.page.screenshot({
      clip: { x: Math.round(iframeBox.x), y: Math.round(iframeBox.y), width: Math.round(iframeBox.width), height: Math.round(iframeBox.height) },
    })

    const desktopMedia = desktopTabs.media
    if (desktopMedia === undefined) throw new Error('missing desktop media capture')
    for (const needle of ['aria-label="Main menu"', 'title="Export video"']) {
      expect(
        desktopMedia.tree.some((line) => line.includes(needle)),
        `desktop renders ${needle}`,
      ).toBe(true)
    }
    expect(desktopMedia.regions.player, 'desktop renders the player').not.toBeNull()
    expect(desktopMedia.tree.filter((line) => line.includes('data-slot="resizable-panel"')).length, 'desktop panel count').toBe(5)

    const differences: Difference[] = []
    for (const tab of LEFT_TABS) {
      const a = desktopTabs[tab]
      const b = embedTabs[tab]
      if (a === undefined || b === undefined) throw new Error(`missing capture for ${tab}`)
      differences.push(...diffCaptures(tab, a, b))
      if (tab === 'media') differences.push(...diffCaptures('native chrome', desktopNative, b).filter((difference) => difference.kind === 'root'))
    }
    const toDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`
    const pixels = await embed.page.evaluate(comparePixels, { a: toDataUrl(desktopPng), b: toDataUrl(embedPng), threshold: PIXEL_THRESHOLD })

    const classified = differences.map((difference) => ({ ...difference, omission: classify(difference, EMBED_OMISSIONS) }))
    const unexplained = classified.filter((difference) => difference.omission === null)
    const covered = new Set(classified.map((difference) => difference.omission).filter((omission): omission is EmbedOmission => omission !== null))

    await writeFile(path.join(reportDir, 'desktop-native.png'), desktopNativePng)
    await writeFile(path.join(reportDir, 'desktop.png'), desktopPng)
    await writeFile(path.join(reportDir, 'embed.png'), embedPng)
    await writeFile(path.join(reportDir, 'diff.png'), Buffer.from(pixels.diffPng.split(',')[1] ?? '', 'base64'))
    await writeFile(path.join(reportDir, 'captures.json'), JSON.stringify({ desktopNative, desktopTabs, embedTabs }, null, 2))
    await writeFile(path.join(reportDir, 'report.md'), renderReport({ classified, pixels: pixels.mismatch, omissions: EMBED_OMISSIONS, covered }))

    expect(
      unexplained.map((difference) => `${difference.kind} ${difference.detail}`),
      `unexplained differences, see ${path.relative(repoRoot, reportDir)}/report.md`,
    ).toEqual([])
    expect(pixels.mismatch, 'screenshot mismatch ratio').toBeLessThan(MAX_PIXEL_MISMATCH)
  } finally {
    await embed?.browser.close()
    await desktop?.app.close()
    if (desktop) await rm(desktop.configHome, { recursive: true, force: true })
    display.stop()
    site.server.close()
  }
})
