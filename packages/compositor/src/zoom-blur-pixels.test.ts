import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import type { ZoomBlurReading } from './zoom-blur-probe'

let server: ReturnType<typeof Bun.serve>
let browser: Browser
let page: Page

beforeAll(async () => {
  const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/zoom-blur-probe.ts`], target: 'browser' })
  const script = await bundle.outputs[0]?.text()
  if (!bundle.success || script === undefined) throw new Error(bundle.logs.join('\n'))
  server = Bun.serve({ port: 0, fetch: () => new Response(`<script type="module">${script}</script>`, { headers: { 'content-type': 'text/html' } }) })
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
