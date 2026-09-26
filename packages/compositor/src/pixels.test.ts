import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import type { MagnifiedReading } from './magnified-multicam-probe'
import type { MulticamParity } from './multicam-parity-probe'
import type { ZoomBlurReading } from './zoom-blur-probe'

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let page: Page

beforeAll(async () => {
  const probes = ['zoom-blur-probe', 'magnified-multicam-probe', 'multicam-parity-probe'].map((name) => `${import.meta.dir}/${name}.ts`)
  const bundle = await Bun.build({ entrypoints: probes, target: 'browser' })
  if (!bundle.success) throw new Error(bundle.logs.join('\n'))
  const scripts = await Promise.all(bundle.outputs.map((output) => output.text()))
  const html = scripts.map((script) => `<script type="module">${script}</script>`).join('')
  server = Bun.serve({ port: 0, fetch: () => new Response(html, { headers: { 'content-type': 'text/html' } }) })
  browser = await chromium.launch()
  page = await browser.newPage()
  await page.goto(server.url.href)
}, 30_000)

afterAll(async () => {
  await browser.close()
  server.stop()
})

test.each([8, 16])('a zoom ramp blurred over %i samples keeps flat grey at 100 and the camera slot within one level of its still frame', async (samples) => {
  const reading: ZoomBlurReading = await page.evaluate((count) => zoomBlurProbe(count), samples)
  expect(Math.abs(reading.grey - 100)).toBeLessThanOrEqual(1)
  expect(reading.cameraMaxShift).toBeLessThanOrEqual(1)
})

test('a multicam magnified 2x keeps a checkerboard as crisp as a video clip magnified 2x, at export, in a half-scale preview, cropped, and by a zoom region', async () => {
  const reading: MagnifiedReading = await page.evaluate(() => magnifiedMulticamProbe())
  expect(reading).toEqual({
    export: { video: 128, multicam: 128 },
    halfPreview: { video: 128, multicam: 128 },
    cropped: { video: 128, multicam: 128 },
    zoomed: { video: 128, multicam: 128 },
  })
})

test('a multicam matches drawing its slots straight onto the canvas within one level, cropped, cropped under a zoom region, rotated, and cropped in a 0.6 preview', async () => {
  const parity: MulticamParity = await page.evaluate(() => multicamParityProbe())
  expect(Object.entries(parity).filter(([, delta]) => delta > 1)).toEqual([])
})
