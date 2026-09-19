import { expect, test } from '@playwright/test'
import path from 'node:path'
import { clip, collectErrors, dragAssetToLane, openEditor, previewPixels } from './helpers'

// Playwright's Chromium lacks the licensed codecs Chrome bundles, so the committed MKV fixture is VP9 rather than H.264. https://playwright.dev/docs/browsers#media-codecs
const fixture = process.env.MKV_FIXTURE ?? 'fixture-vp9'

test('mkv imports, shows a filmstrip, and renders preview frames', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await openEditor(page)

  await page.setInputFiles('input[type="file"]', path.join(__dirname, 'fixtures', `${fixture}.mkv`))
  await expect(page.getByTitle(new RegExp(`${fixture}\\.mkv`))).toBeVisible({ timeout: 10_000 })

  await dragAssetToLane(page, new RegExp(`${fixture}\\.mkv`), { offsetX: 120 })
  await expect(clip(page)).toHaveCount(1)

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-clip=video] canvas')
          if (!canvas) return -1
          const ctx = canvas.getContext('2d')!
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          let lit = 0
          for (let i = 0; i < data.length; i += 16) {
            if (data[i]! > 30 || data[i + 1]! > 30 || data[i + 2]! > 30) lit++
          }
          return lit
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(100)

  const clipBox = (await clip(page).first().boundingBox())!
  const ruler = page.locator('div.cursor-col-resize.bg-card').first()
  const rulerBox = (await ruler.boundingBox())!
  await ruler.click({
    position: { x: clipBox.x + clipBox.width * 0.15 - rulerBox.x, y: rulerBox.height / 2 },
  })
  await expect.poll(() => previewPixels(page), { timeout: 15_000 }).toBeGreaterThan(100)

  await page.keyboard.press('Space')
  await page.waitForTimeout(1000)
  expect(await previewPixels(page)).toBeGreaterThan(100)
  await page.keyboard.press('Space')

  expect(errors).toEqual([])
})
