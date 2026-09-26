import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import type { ZoomBlurReading } from './zoom-blur-probe'

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let page: Page

beforeAll(async () => {
  const probes = ['zoom-blur-probe'].map((name) => `${import.meta.dir}/${name}.ts`)
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
