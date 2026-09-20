import { expect, test, type Page } from './electron-fixture'
import { clip, openEditor, openLeftTab } from './helpers'

async function addTwoTitles(page: Page) {
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await page.getByTitle(/Subtitle — drag/).click()
  await expect(clip(page)).toHaveCount(2)
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(2)
}

const timecode = (page: Page) => page.locator('[data-mcut-timeline] .text-primary').first().textContent()

test('solo mutes every other track and toggles back', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)
  await page.getByTitle('Solo track (mute all others)').first().click()
  await expect(page.getByTitle('Unmute track')).toHaveCount(1)
  await page.getByTitle('Solo track (mute all others)').first().click()
  await expect(page.getByTitle('Unmute track')).toHaveCount(0)
})

test('hover delete button removes a track', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)
  await page.locator('[data-mcut-timeline] span.truncate').first().hover()
  await page.getByTitle('Delete track').first().click()
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(1)
})

test('↑/↓ jump the playhead between clip edges', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await page.keyboard.press('End')
  expect(await timecode(page)).toBe('0:03.0')
  await page.keyboard.press('ArrowUp')
  expect(await timecode(page)).toBe('0:00.0')
  await page.keyboard.press('ArrowDown')
  expect(await timecode(page)).toBe('0:03.0')
})

test('J/K/L shuttles playback both directions', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('l')
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await page.waitForTimeout(400)
  const forward = await timecode(page)
  expect(forward).not.toBe('0:00.0')
  await page.keyboard.press('k')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  const before = await timecode(page)
  await page.keyboard.press('j')
  await page.waitForTimeout(400)
  await page.keyboard.press('k')
  const after = await timecode(page)
  expect(after! < before!).toBe(true)
})

test('insert track above via header context menu', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await page.locator('[data-mcut-timeline] span.truncate').first().click({ button: 'right' })
  await page.getByText('Insert track above').click()
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(2)
})
