import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { comparePixels } from '../scripts/embed-parity-capture'

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const studioOut = path.join(repoRoot, 'apps/studio/out')
const webPublic = path.join(repoRoot, 'apps/web/public')
const posterPath = path.join(webPublic, 'demo/studio-phone.webp')
const CROP = { x: 0, y: 0, width: 717, height: 560 }
const OUTPUT = { width: 1100, height: 859 }
const WRITE = process.env.WRITE_PHONE_POSTER === '1'
const MAX_MISMATCH = 0.02

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function serve(roots: string[]): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://site').pathname)
    const names = pathname === '/' ? ['index.html'] : [pathname.slice(1), `${pathname.slice(1)}.html`]
    const file = roots
      .flatMap((root) => names.map((name) => path.join(root, name)))
      .find((candidate) => existsSync(candidate) && path.extname(candidate) !== '')
    if (file === undefined) {
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

test('the phone poster matches the Studio export', async ({ browser }) => {
  test.setTimeout(120_000)
  if (!existsSync(path.join(studioOut, 'embed.html'))) throw new Error('build apps/studio first')
  const site = await serve([studioOut, webPublic])
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await context.newPage()
  try {
    await page.goto(`${site.url}/embed?clip=${encodeURIComponent('/demo/sample.mp4')}&muted=1`)
    await page.locator('[data-mcut-clip]').waitFor({ timeout: 60_000 })
    await page.evaluate(() => window.postMessage({ type: 'mcut:embed:pause' }, window.location.origin))
    await page.mouse.move(640, 700)
    await page.locator('section[aria-label^="Notifications"] li').first().waitFor({ state: 'detached', timeout: 15_000 })
    await page.waitForTimeout(500)
    const png = await page.screenshot({ clip: CROP })
    const rendered = await page.evaluate(
      async ({ png, width, height }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${png}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('no 2d context')
        context.drawImage(image, 0, 0, width, height)
        return canvas.toDataURL('image/webp', 0.8)
      },
      { png: png.toString('base64'), ...OUTPUT },
    )
    const bytes = Buffer.from(rendered.slice(rendered.indexOf(',') + 1), 'base64')
    if (WRITE || !existsSync(posterPath)) {
      writeFileSync(posterPath, bytes)
      return
    }
    const committed = `data:image/webp;base64,${readFileSync(posterPath).toString('base64')}`
    const diff = await page.evaluate(comparePixels, { a: rendered, b: committed, threshold: 24 })
    expect(
      diff.mismatch,
      `apps/web/public/demo/studio-phone.webp is stale against the Studio export. Run bun run --cwd apps/studio poster:phone:write and commit the result.`,
    ).toBeLessThan(MAX_MISMATCH)
  } finally {
    await context.close()
    site.server.close()
  }
})
