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
  Reflect.set(globalThis, 'document', { createElement: (tag: string) => (tag === 'video' ? new FakeVideo() : new FakeMedia()) })
})

afterAll(() => {
  Reflect.set(globalThis, 'HTMLVideoElement', saved.video)
  Reflect.set(globalThis, 'document', saved.document)
})

test('a cleaned copy keeps a simultaneous dry copy of the same asset audible', () => {
  const asset: AssetRef = { id: 'a-shared', kind: 'audio', src: 'blob:dry' }
  const pool = new PreviewMediaPool(() => asset)
  const base: ActiveMediaItem = {
    assetId: asset.id,
    kind: 'audio',
    sourceTimeMs: 0,
    rate: 1,
    volume: 0.5,
  }
  pool.sync([base, { ...base, audioSrc: 'blob:wet' }], {
    isPlaying: true,
    playbackRate: 1,
    masterVolume: 1,
    muted: false,
  })
  expect(created).toHaveLength(2)
  expect(created[0]?.muted).toBe(false)
  expect(created[1]?.muted).toBe(false)
})

test('a paused seek and its seeked event each move the frame version, and an idle sync does not', () => {
  const asset: AssetRef = { id: 'a-clip', kind: 'video', src: 'blob:clip', nativePreview: true }
  const pool = new PreviewMediaPool(() => asset)
  const paused = { isPlaying: false, playbackRate: 1, masterVolume: 1, muted: false }
  const item: ActiveMediaItem = { assetId: asset.id, kind: 'video', sourceTimeMs: 2000, rate: 1, volume: 0 }

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
