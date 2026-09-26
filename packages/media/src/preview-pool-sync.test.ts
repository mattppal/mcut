import { afterAll, beforeAll, expect, test } from 'bun:test'
import { PreviewMediaPool, type ActiveMediaItem } from './preview-pool'
import type { AssetRef } from '@mcut/timeline'

const created: FakeMedia[] = []

class FakeMedia {
  src = ''
  preload = ''
  crossOrigin = ''
  volume = 1
  muted = false
  paused = true
  currentTime = 0
  playbackRate = 1
  seeking = false
  error: null = null
  readyState = 0
  listeners = new Map<string, () => void>()

  constructor() {
    created.push(this)
  }

  play(): Promise<void> {
    this.paused = false
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  load(): void {}
  removeAttribute(): void {}
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener)
  }
}

class FakeVideo extends FakeMedia {}

const saved = { video: Reflect.get(globalThis, 'HTMLVideoElement'), document: Reflect.get(globalThis, 'document') }

beforeAll(() => {
  Reflect.set(globalThis, 'HTMLVideoElement', FakeVideo)
  Reflect.set(globalThis, 'document', { createElement: () => new FakeVideo() })
})

afterAll(() => {
  Reflect.set(globalThis, 'HTMLVideoElement', saved.video)
  Reflect.set(globalThis, 'document', saved.document)
})

test('a paused seek and its seeked event each move the frame version, and an idle sync does not', () => {
  const asset: AssetRef = { id: 'a-clip', kind: 'video', src: 'blob:clip', nativePreview: true }
  const pool = new PreviewMediaPool(() => asset)
  const paused = { isPlaying: false, playbackRate: 1 }
  const item: ActiveMediaItem = { assetId: asset.id, sourceTimeMs: 2000, rate: 1 }

  pool.sync([item], paused)
  const video = created.at(-1)
  const afterSeek = pool.frameVersion
  expect(video?.currentTime).toBe(2)
  expect(afterSeek).toBeGreaterThan(0)

  pool.sync([item], paused)
  expect(pool.frameVersion).toBe(afterSeek)

  video?.listeners.get('seeked')?.()
  expect(pool.frameVersion).toBe(afterSeek + 1)
})

test('a playing picture 20 ms behind the audio clock speeds up and one 20 ms ahead slows down', () => {
  const asset: AssetRef = { id: 'a-cam', kind: 'video', src: 'blob:cam', nativePreview: true }
  const pool = new PreviewMediaPool(() => asset)
  const playing = { isPlaying: true, playbackRate: 1 }
  pool.sync([{ assetId: asset.id, sourceTimeMs: 1000, rate: 1 }], playing)
  const video = created.at(-1)
  if (!video) throw new Error('no video element')
  video.currentTime = 1.98
  pool.sync([{ assetId: asset.id, sourceTimeMs: 2000, rate: 1 }], playing)
  const behind = video.playbackRate
  video.currentTime = 2.02
  pool.sync([{ assetId: asset.id, sourceTimeMs: 2000, rate: 1 }], playing)
  expect([behind > 1, video.playbackRate < 1]).toEqual([true, true])
})

test('a playing video element stays muted so its sound comes only from the preview audio graph', () => {
  const asset: AssetRef = { id: 'a-talk', kind: 'video', src: 'blob:talk', nativePreview: true }
  const pool = new PreviewMediaPool(() => asset)
  pool.sync([{ assetId: asset.id, sourceTimeMs: 0, rate: 1 }], { isPlaying: true, playbackRate: 1 })
  expect({ muted: created.at(-1)?.muted, paused: created.at(-1)?.paused }).toEqual({ muted: true, paused: false })
})
