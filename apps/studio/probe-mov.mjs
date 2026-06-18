// Can Chrome actually load/play a .mov H.264+AAC blob in <video>/<audio>,
// despite canPlayType('video/quicktime') === ""?
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

const bytes = readFileSync(process.argv[2] ?? '/tmp/fixture-h264.mov')
const result = await page.evaluate(async (base64) => {
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const blob = new Blob([arr], { type: 'video/quicktime' })
  const url = URL.createObjectURL(blob)

  const tryLoad = (tag) =>
    new Promise((resolve) => {
      const el = document.createElement(tag)
      el.src = url
      el.preload = 'auto'
      el.muted = true
      const timer = setTimeout(
        () => resolve({ tag, outcome: 'timeout', readyState: el.readyState }),
        5000,
      )
      el.addEventListener('loadeddata', () => {
        clearTimeout(timer)
        resolve({
          tag,
          outcome: 'loaded',
          readyState: el.readyState,
          duration: el.duration,
          videoTracks: el.videoTracks?.length,
          audioTracks: el.audioTracks?.length,
        })
      })
      el.addEventListener('error', () => {
        clearTimeout(timer)
        resolve({ tag, outcome: 'error', code: el.error?.code, message: el.error?.message })
      })
    })

  return {
    canPlayType: document.createElement('video').canPlayType('video/quicktime'),
    video: await tryLoad('video'),
    audio: await tryLoad('audio'),
  }
}, bytes.toString('base64'))

console.log(JSON.stringify(result, null, 2))
await browser.close()
