import { expect, test, type Page } from './electron-fixture'
import { collectErrors, openEditor, openLeftTab } from './helpers'

async function addTwoTitles(page: Page) {
  await openLeftTab(page, 'text')
  await page.getByTitle(/Title — drag/).click()
  await page.getByTitle(/Subtitle — drag/).click()
  await expect(page.locator('[data-mcut-clip]')).toHaveCount(2)
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(2)
}

const laneClips = (page: Page, lane: number) => page.locator('[data-mcut-lane]').nth(lane).locator('[data-mcut-clip]')

test('dragging a clip up a lane moves it across tracks; one undo restores it', async ({ page, editorUrl }) => {
  const errors = collectErrors(page)
  await openEditor(page, editorUrl)
  await addTwoTitles(page)

  const box = (await laneClips(page, 1).first().boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 250, startY - 56, { steps: 12 })
  await page.mouse.up()

  await expect(laneClips(page, 0)).toHaveCount(2)
  await expect(laneClips(page, 1)).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(laneClips(page, 0)).toHaveCount(1)
  await expect(laneClips(page, 1)).toHaveCount(1)
  expect(errors).toEqual([])
})

test('escape cancels a drag in flight and restores the clip', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)

  const before = (await laneClips(page, 1).first().boundingBox())!
  const startX = before.x + before.width / 2
  const startY = before.y + before.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 200, startY - 56, { steps: 12 })
  await page.keyboard.press('Escape')
  await page.mouse.up()

  await expect(laneClips(page, 0)).toHaveCount(1)
  await expect(laneClips(page, 1)).toHaveCount(1)
  const after = (await laneClips(page, 1).first().boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThan(2)
})

test('dragging above the top lane spawns a new track', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)

  const box = (await laneClips(page, 1).first().boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 30, startY - 2 * 56, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('[data-mcut-lane]')).toHaveCount(3)
  await expect(laneClips(page, 0)).toHaveCount(1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('[data-mcut-lane]')).toHaveCount(2)
  await expect(laneClips(page, 1)).toHaveCount(1)
})

test('a release lost outside the window ends the drag instead of stranding it', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)

  const box = (await laneClips(page, 1).first().boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await page.context().newCDPSession(page)
  const move = (mx: number, my: number, buttons: number) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my, button: 'none', buttons })

  await move(x, y, 0)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await move(x + 100, y, 1)
  const during = (await laneClips(page, 1).first().boundingBox())!
  expect(Math.abs(during.x - (box.x + 100))).toBeLessThan(2)

  await move(x + 500, y - 112, 0)
  await move(x + 300, y - 56, 0)
  const after = (await laneClips(page, 1).first().boundingBox())!
  expect(Math.abs(after.x - during.x)).toBeLessThan(2)
  expect(Math.abs(after.y - during.y)).toBeLessThan(2)

  await page.keyboard.press('ControlOrMeta+z')
  const restored = (await laneClips(page, 1).first().boundingBox())!
  expect(Math.abs(restored.x - box.x)).toBeLessThan(2)
})

test('plain click still selects without starting a drag transaction', async ({ page, editorUrl }) => {
  await openEditor(page, editorUrl)
  await addTwoTitles(page)

  const target = laneClips(page, 1).first()
  await target.click()
  await expect(target).toHaveClass(/ring-2/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('[data-mcut-clip]')).toHaveCount(1)
})
