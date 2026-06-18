// Repro: video loading + audio after session restore (reload → Restore).
// Run from apps/studio: bun ./repro-startup.mjs <baseURL>
import { chromium } from '@playwright/test'

const baseURL = process.argv[2] ?? 'http://127.0.0.1:3123'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`)
})

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
        src: r.el.src.slice(0, 50),
        paused: r.el.paused,
        muted: r.el.muted,
        volume: r.el.volume,
        currentTime: r.el.currentTime,
        readyState: r.el.readyState,
        networkState: r.el.networkState,
        error: r.el.error ? `${r.el.error.code}: ${r.el.error.message}` : null,
      }))
    return { nonBlackPixels: nonBlack, media }
  })

// ---- Phase A: fresh import + playback ------------------------------------
await page.goto(`${baseURL}/editor`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByText('Discard').click({ timeout: 1500 }).catch(() => {})

const base64 = await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  const audio = new AudioContext()
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  gain.gain.value = 0.3
  const destination = audio.createMediaStreamDestination()
  oscillator.connect(gain).connect(destination)
  oscillator.frequency.value = 220
  oscillator.start()
  const stream = canvas.captureStream(30)
  destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks = []
  recorder.ondataavailable = (e) => chunks.push(e.data)
  recorder.start(100)
  let frame = 0
  const interval = setInterval(() => {
    frame++
    ctx.fillStyle = `hsl(${(frame * 5) % 360} 70% 45%)`
    ctx.fillRect(0, 0, 640, 360)
  }, 33)
  await new Promise((r) => setTimeout(r, 4200))
  clearInterval(interval)
  recorder.stop()
  await new Promise((r) => (recorder.onstop = r))
  oscillator.stop()
  const blob = new Blob(chunks, { type: 'video/webm' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
})
await page.setInputFiles('input[type="file"]', {
  name: 'fixture.webm',
  mimeType: 'video/webm',
  buffer: Buffer.from(base64, 'base64'),
})
await page.getByTitle(/fixture\.webm/).waitFor({ timeout: 15_000 })

const card = page.getByTitle(/fixture\.webm/).first()
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
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(1200) // sample MID-playback

console.log('=== Phase A: fresh import, mid-playback ===')
console.log(JSON.stringify(await mediaSnapshot(), null, 2))
await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {})

// Let the autosave debounce (800ms) flush.
await page.waitForTimeout(1500)

// ---- Phase B: reload + restore -------------------------------------------
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const restore = page.getByText('Restore', { exact: true })
const hasRestorePrompt = await restore.isVisible().catch(() => false)
console.log('restore prompt visible:', hasRestorePrompt)
if (hasRestorePrompt) await restore.click()
await page.waitForTimeout(800)

const clips = await page.locator('[data-mcut-clip]').count()
console.log('clips after restore:', clips)

await page.getByRole('button', { name: 'Go to start' }).click()
await page.waitForTimeout(1200)
console.log('=== Phase B: after restore, paused at t=0 ===')
console.log(JSON.stringify(await mediaSnapshot(), null, 2))
await page.screenshot({ path: '/tmp/mcut-restore-paused.png' })

await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(1500) // sample MID-playback
console.log('=== Phase B: after restore, mid-playback ===')
console.log(JSON.stringify(await mediaSnapshot(), null, 2))
await page.screenshot({ path: '/tmp/mcut-restore-playing.png' })

console.log('page errors:', errors.length ? errors : 'none')
await browser.close()
