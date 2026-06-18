// Repro: .mov assets + session restore ("first start" path).
// Run from apps/studio: bun ./repro-mov-restore.mjs <baseURL>
import { chromium } from '@playwright/test'

const baseURL = process.argv[2] ?? 'http://127.0.0.1:3123'
const files = ['/tmp/fixture-h264.mov', '/tmp/cam-a.mov', '/tmp/cam-b.mov']

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`))

const snapshot = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-mcut-player] canvas')
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let nonBlack = 0
    for (let i = 0; i < data.length; i += 64) {
      if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) nonBlack++
    }
    return { nonBlackPixels: nonBlack }
  })

await page.goto(`${baseURL}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByText('Discard').click({ timeout: 1500 }).catch(() => {})

for (const file of files) {
  await page.setInputFiles('input[type="file"]', file)
  const name = file.split('/').pop()
  await page.getByTitle(new RegExp(name.replace('.', '\\.'))).waitFor({ timeout: 30_000 })
}

// Drop the first asset on the timeline at t≈0.
const card = page.getByTitle(/fixture-h264\.mov/).first()
const cardBox = await card.boundingBox()
await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
await page.mouse.down()
await page.mouse.move(cardBox.x + 70, cardBox.y + 90, { steps: 5 })
await page.waitForTimeout(200)
const lane = page.locator('[data-mcut-lane]').first()
const laneBox = await lane.boundingBox()
await page.mouse.move(laneBox.x + 120, laneBox.y + laneBox.height / 2, { steps: 10 })
await page.mouse.move(laneBox.x + 121, laneBox.y + laneBox.height / 2 + 1)
await page.waitForTimeout(200)
await page.mouse.up()
await page.waitForTimeout(300)
const clipBox = await page.locator('[data-mcut-clip]').first().boundingBox()
await page.mouse.move(clipBox.x + 30, clipBox.y + clipBox.height / 2)
await page.mouse.down()
await page.mouse.move(laneBox.x - 40, clipBox.y + clipBox.height / 2, { steps: 8 })
await page.mouse.up()
await page.getByRole('button', { name: 'Go to start' }).click()
await page.waitForTimeout(1500)
console.log('fresh import, paused t=0:', JSON.stringify(await snapshot()))

// Autosave flush, then simulate "first start": reload + Restore.
await page.waitForTimeout(1500)
for (let round = 1; round <= 3; round++) {
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const restore = page.getByText('Restore', { exact: true })
  if (await restore.isVisible().catch(() => false)) await restore.click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Go to start' }).click().catch(() => {})

  // Sample the preview over 6 seconds — does the frame ever appear?
  const samples = []
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000)
    samples.push((await snapshot()).nonBlackPixels)
  }
  console.log(`restore round ${round}: pixels over 6s = ${samples.join(', ')}`)
}

console.log('--- logs ---')
for (const l of logs) if (!l.includes('willReadFrequently')) console.log(l)
await browser.close()
