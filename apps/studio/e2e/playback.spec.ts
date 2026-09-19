import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test as base, type Page } from './electron-fixture'
import { dragAssetToLane, openEditor, previewPixels } from './helpers'

const FIXTURE_DIR = join(tmpdir(), 'mcut-e2e-fixtures')
const SMOOTH_FIXTURE = join(FIXTURE_DIR, 'smooth-8s.webm')
const LONG_GOP_FIXTURE = join(FIXTURE_DIR, 'long-gop-20s.webm')

function ffmpeg(args: string[]): boolean {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { timeout: 120_000 })
    return true
  } catch {
    return false
  }
}

interface MediaRecord {
  tag: string
  el: HTMLMediaElement
  seeks: number
  events: Array<[string, number]>
}

declare global {
  interface Window {
    __mediaStats: {
      elements: MediaRecord[]
      poolVideo: () => MediaRecord | undefined
    }
  }
}

const test = base.extend<{ mediaStats: void }>({
  mediaStats: async ({ page }, use) => {
    const script = await page.addInitScript(() => {
      const elements: Window['__mediaStats']['elements'] = []
      const stats = (window.__mediaStats = {
        elements,
        poolVideo: () => elements.find((rec) => rec.tag === 'video' && rec.events.some(([name]) => name === 'playing')),
      })
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!
      const origCreate = Document.prototype.createElement
      Document.prototype.createElement = function (this: Document, tag: string, ...rest: unknown[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = (origCreate as any).call(this, tag, ...rest) as HTMLElement
        if (tag === 'video' || tag === 'audio') {
          const media = el as HTMLMediaElement
          const rec = { tag, el: media, seeks: 0, events: [] as Array<[string, number]> }
          stats.elements.push(rec)
          for (const name of ['seeking', 'seeked', 'waiting', 'stalled', 'playing', 'error']) {
            media.addEventListener(name, () => rec.events.push([name, Math.round(performance.now())]))
          }
          Object.defineProperty(media, 'currentTime', {
            get: () => desc.get!.call(media),
            set(value: number) {
              rec.seeks++
              desc.set!.call(media, value)
            },
          })
        }
        return el
      } as typeof Document.prototype.createElement
    })
    await use()
    await script.dispose()
  },
})

let haveFixtures = false
test.beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  haveFixtures =
    (existsSync(SMOOTH_FIXTURE) ||
      ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=8', '-c:v', 'libvpx', '-b:v', '2M', '-auto-alt-ref', '0', SMOOTH_FIXTURE])) &&
    (existsSync(LONG_GOP_FIXTURE) ||
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=2560x1440:rate=30:duration=20',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=20',
        '-c:v',
        'libvpx-vp9',
        '-deadline',
        'realtime',
        '-cpu-used',
        '8',
        '-row-mt',
        '1',
        '-b:v',
        '6M',
        '-g',
        '600',
        '-c:a',
        'libopus',
        LONG_GOP_FIXTURE,
      ]))
})

async function importFile(page: Page, path: string, title: RegExp): Promise<void> {
  await page.setInputFiles('input[type="file"]', path)
  await expect(page.getByTitle(title)).toBeVisible({ timeout: 30_000 })
}

async function dragClipToStart(page: Page): Promise<void> {
  const clipBox = (await page.locator('[data-mcut-clip]').first().boundingBox())!
  const laneBox = (await page.locator('[data-mcut-lane]').first().boundingBox())!
  await page.mouse.move(clipBox.x + 30, clipBox.y + clipBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(laneBox.x - 40, clipBox.y + clipBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test.beforeEach(() => {
  test.skip(!haveFixtures, 'ffmpeg unavailable — cannot synthesize video fixtures')
})

test('paused preview displays the frame under the playhead', async ({ page, editorUrl, mediaStats }) => {
  await openEditor(page, editorUrl)
  await importFile(page, SMOOTH_FIXTURE, /smooth-8s\.webm/)
  await dragAssetToLane(page, /smooth-8s\.webm/, { offsetX: 120 })
  await dragClipToStart(page)

  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1200)
  expect(await previewPixels(page)).toBeGreaterThan(100)

  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.waitForTimeout(1200)
  expect(await previewPixels(page)).toBeGreaterThan(100)
})

test('playback advances content at near-source fps without seek churn', async ({ page, editorUrl, mediaStats }) => {
  test.setTimeout(120_000)
  await openEditor(page, editorUrl)
  await importFile(page, SMOOTH_FIXTURE, /smooth-8s\.webm/)
  await dragAssetToLane(page, /smooth-8s\.webm/, { offsetX: 120 })
  await dragClipToStart(page)
  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Play', exact: true }).click()

  const measured = await page.evaluate(async () => {
    const { poolVideo } = window.__mediaStats
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('pool video never started')), 10_000)
      const check = () => {
        const rec = poolVideo()
        if (rec && !rec.el.paused && rec.el.readyState >= 2) {
          clearTimeout(deadline)
          resolve()
        } else requestAnimationFrame(check)
      }
      check()
    })
    const rec = poolVideo()
    const canvas = document.querySelector<HTMLCanvasElement>('[data-mcut-player] canvas')
    const sample = document.createElement('canvas')
    sample.width = 64
    sample.height = 36
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true })
    if (!rec || !(rec.el instanceof HTMLVideoElement) || !canvas || !sampleCtx) {
      throw new Error('preview canvas or pool video missing')
    }
    const video = rec.el

    let ticks = 0
    let distinct = 0
    let lastHash = ''
    let firstPresented = -1
    let lastPresented = -1
    const seeksBefore = rec.seeks
    const start = performance.now()
    const done = start + 5000
    const onVideoFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      if (firstPresented < 0) firstPresented = metadata.presentedFrames
      lastPresented = metadata.presentedFrames
      if (performance.now() < done) video.requestVideoFrameCallback(onVideoFrame)
    }
    video.requestVideoFrameCallback(onVideoFrame)
    await new Promise<void>((resolve) => {
      const tick = () => {
        ticks++
        sampleCtx.drawImage(canvas, 0, 0, sample.width, sample.height)
        const data = sampleCtx.getImageData(0, 0, sample.width, sample.height).data
        let hash = 0
        for (let i = 0; i < data.length; i += 4) hash = (hash * 31 + (data[i] ?? 0)) | 0
        const key = String(hash)
        if (key !== lastHash) distinct++
        lastHash = key
        if (performance.now() < done) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const elapsedS = (performance.now() - start) / 1000
    return {
      presentedFps: (lastPresented - firstPresented) / elapsedS,
      rafHz: ticks / elapsedS,
      contentFps: distinct / elapsedS,
      seeksDuringPlayback: rec.seeks - seeksBefore,
    }
  })

  expect(measured.seeksDuringPlayback).toBeLessThan(3)
  expect(measured.presentedFps, "frames the pool's <video> handed to the compositor per second, from a 30 fps source").toBeGreaterThan(24)
  expect(
    measured.contentFps,
    'distinct preview frames per second; ScrubFrameCache frames sit 90 ms apart, so a cache-fed preview tops out at 11, and the canvas can only change once per animation frame',
  ).toBeGreaterThan(Math.min(15, measured.rafHz / 2))
})

test('skip-ahead on a long-GOP file recovers without a seek spiral', async ({ page, editorUrl, mediaStats }) => {
  test.setTimeout(180_000)
  await openEditor(page, editorUrl)
  await importFile(page, LONG_GOP_FIXTURE, /long-gop-20s\.webm/)
  await dragAssetToLane(page, /long-gop-20s\.webm/, { offsetX: 120 })
  await dragClipToStart(page)
  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.waitForTimeout(500)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(2500)
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(6000)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const report = await page.evaluate(() => {
    const video = window.__mediaStats.poolVideo()
    if (!video) throw new Error('pool video never played')
    return { seeks: video.seeks, currentTime: video.el.currentTime }
  })

  expect(report.seeks, "seeks on the pool's <video>, not the filmstrip's").toBeLessThan(5)
  expect(report.currentTime).toBeGreaterThan(4)
})
