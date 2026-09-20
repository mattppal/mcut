import { expect, test, type Page } from './electron-fixture'
import { clip, openEditor, openLeftTab } from './helpers'

async function addTitleAtPlayhead(page: Page) {
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
}

test('⇧⌫ ripple delete closes the gap', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTitleAtPlayhead(page)
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.getByTitle(/Subtitle — drag/).click()
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(1)
  await expect(clip(page)).toHaveCount(2)

  const before = (await clip(page).nth(1).boundingBox())!
  await clip(page).first().click()
  await page.keyboard.press('Shift+Backspace')
  await expect(clip(page)).toHaveCount(1)
  const after = (await clip(page).first().boundingBox())!
  expect(before.x - after.x).toBeGreaterThan(80)
})

test('Q and W trim the selected clip to the playhead', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTitleAtPlayhead(page)
  const before = (await clip(page).first().boundingBox())!
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('w')
  const afterW = (await clip(page).first().boundingBox())!
  expect(afterW.width).toBeLessThan(before.width * 0.5)

  await page.keyboard.press('End')
  await addTitleAtPlayhead(page)
  const second = clip(page).nth(1)
  const beforeQ = (await second.boundingBox())!
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('q')
  const afterQ = (await second.boundingBox())!
  expect(afterQ.x).toBeGreaterThan(beforeQ.x + 20)
  expect(afterQ.width).toBeLessThan(beforeQ.width - 20)
})

test('⇧S splits every track under the playhead', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTitleAtPlayhead(page)
  await page.getByTitle(/Subtitle — drag/).click()
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+s')
  await expect(clip(page)).toHaveCount(4)
})

test('⌘= zooms in and ⇧Z fits', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTitleAtPlayhead(page)
  const before = (await clip(page).first().boundingBox())!
  await page.keyboard.press('ControlOrMeta+=')
  await page.keyboard.press('ControlOrMeta+=')
  const zoomed = (await clip(page).first().boundingBox())!
  expect(zoomed.width).toBeGreaterThan(before.width * 1.4)
  await page.keyboard.press('Shift+z')
  const fitted = (await clip(page).first().boundingBox())!
  expect(fitted.width).toBeGreaterThan(800)
})

test('⌘S is intercepted with an autosave toast', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText(/Autosaved — projects persist/)).toBeVisible()
})
