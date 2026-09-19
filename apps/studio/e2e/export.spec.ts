import { expect, test } from './electron-fixture'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { clip, collectErrors, dragAssetToLane, openEditor, openLeftTab } from './helpers'

test('export renders a webm in the worker and downloads it', async ({ page, editorUrl, downloads }) => {
  test.slow()
  const errors = collectErrors(page)
  await openEditor(page, editorUrl)

  await page.setInputFiles('input[type="file"]', path.join(__dirname, 'fixtures', 'fixture-vp9.mkv'))
  await expect(page.getByTitle(/fixture-vp9\.mkv/)).toBeVisible({ timeout: 10_000 })
  await dragAssetToLane(page, /fixture-vp9\.mkv/, { offsetX: 120 })
  await expect(clip(page)).toHaveCount(1)

  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await expect(clip(page)).toHaveCount(2)

  await page.locator('[data-mcut-export-trigger]').click()
  await page.getByRole('button', { name: 'WebM', exact: true }).click()

  const downloadPromise = downloads.next(90_000)
  await page.getByRole('button', { name: 'Export WebM' }).click()
  const file = await downloadPromise

  expect(path.basename(file)).toMatch(/\.webm$/)
  expect((await stat(file)).size).toBeGreaterThan(10_000)

  expect(await page.evaluate(() => (globalThis as { __mcutLastExportMode?: string }).__mcutLastExportMode)).toBe('worker')

  expect(errors).toEqual([])
})
