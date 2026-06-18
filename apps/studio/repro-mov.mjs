// Repro: import a real container fixture (.mov/.mp4), play, inspect pool
// behavior + audio. Run from apps/studio: bun ./repro-mov.mjs <baseURL> <file>
import { chromium } from '@playwright/test'

const baseURL = process.argv[2] ?? 'http://127.0.0.1:3123'
const file = process.argv[3] ?? '/tmp/fixture-h264.mov'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const logs = []
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`))

await page.addInitScript(() => {
  const stats = (window.__mediaStats = { elements: [] })
  const origCreate = Document.prototype.createElement
  Document.prototype.createElement = function (tag, ...rest) {
    const el = origCreate.call(this, tag, ...rest)
    if (tag === 'video' || tag === 'audio') stats.elements.push({ tag, el })
    return el
  }
})

const mediaSnapshot = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-mcut-player] canvas')
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let nonBlack = 0
    for (let i = 0; i < data.length; i += 64) {
      if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) nonBlack++
    }
    const media = window.__mediaStats.elements
      .filter((r) => r.el.src)
      .map((r) => ({
        tag: r.tag,
        paused: r.el.paused,
        muted: r.el.muted,
        volume: r.el.volume,
        currentTime: r.el.currentTime,
        readyState: r.el.readyState,
        error: r.el.error ? `${r.el.error.code}` : null,
      }))
    return { nonBlackPixels: nonBlack, media }
  })

await page.goto(`${baseURL}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByText('Discard').click({ timeout: 1500 }).catch(() => {})

await page.setInputFiles('input[type="file"]', file)
const name = file.split('/').pop()
await page.getByTitle(new RegExp(name.replace('.', '\\.'))).waitFor({ timeout: 30_000 })

const card = page.getByTitle(new RegExp(name.replace('.', '\\.'))).first()
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
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Go to start' }).click()
await page.waitForTimeout(1500)

console.log('=== paused at t=0 ===')
console.log(JSON.stringify(await mediaSnapshot(), null, 2))

await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(2000)
console.log('=== mid-playback (t≈2s) ===')
console.log(JSON.stringify(await mediaSnapshot(), null, 2))
await page.screenshot({ path: '/tmp/mcut-mov-playing.png' })

// What the asset looks like to the pool's gating logic:
const gating = await page.evaluate(() => {
  const probe = (mime) => document.createElement('video').canPlayType(mime)
  return {
    quicktime: probe('video/quicktime'),
    mp4: probe('video/mp4'),
    matroska: probe('video/x-matroska'),
  }
})
console.log('canPlayType:', JSON.stringify(gating))
console.log('--- console/page logs ---')
for (const l of logs) console.log(l)
await browser.close()
