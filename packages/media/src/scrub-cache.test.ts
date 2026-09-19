import { describe, expect, test } from 'bun:test'
import { ScrubFrameCache } from './scrub-cache'

class FakeOffscreen {
  constructor(
    public width: number,
    public height: number,
  ) {}
  drawn: unknown[] = []
  getContext() {
    return {
      drawImage: (...args: unknown[]) => {
        this.drawn.push(args)
      },
    }
  }
}

const fakeVideo = { videoWidth: 1920, videoHeight: 1080 } as unknown as HTMLVideoElement

function withOffscreen<T>(fn: () => T): T {
  const previous = (globalThis as Record<string, unknown>).OffscreenCanvas
  ;(globalThis as Record<string, unknown>).OffscreenCanvas = FakeOffscreen
  try {
    return fn()
  } finally {
    if (previous === undefined) delete (globalThis as Record<string, unknown>).OffscreenCanvas
    else (globalThis as Record<string, unknown>).OffscreenCanvas = previous
  }
}

describe('ScrubFrameCache', () => {
  test('captures downscaled frames and serves the nearest', () => {
    withOffscreen(() => {
      const cache = new ScrubFrameCache()
      cache.capture(fakeVideo, 0)
      cache.capture(fakeVideo, 1000)
      cache.capture(fakeVideo, 2000)
      expect(cache.size).toBe(3)
      const frame = cache.nearest(1300) as unknown as FakeOffscreen
      expect(frame).toBe(cache.nearest(900) as unknown as FakeOffscreen)
      expect(frame.width * frame.height).toBeLessThanOrEqual(331_776)
      expect(frame.width / frame.height).toBeCloseTo(1920 / 1080, 1)
    })
  })

  test('deduplicates captures within the minimum gap', () => {
    withOffscreen(() => {
      const cache = new ScrubFrameCache(150, 90)
      cache.capture(fakeVideo, 1000)
      cache.capture(fakeVideo, 1030)
      cache.capture(fakeVideo, 1091)
      expect(cache.size).toBe(2)
    })
  })

  test('evicts FIFO past the cap', () => {
    withOffscreen(() => {
      const cache = new ScrubFrameCache(3, 1)
      for (const t of [0, 100, 200, 300, 400]) cache.capture(fakeVideo, t)
      expect(cache.size).toBe(3)
      const frame = cache.nearest(0)
      expect(frame).toBe(cache.nearest(200))
    })
  })

  test('empty cache returns null and clear() resets', () => {
    withOffscreen(() => {
      const cache = new ScrubFrameCache()
      expect(cache.nearest(0)).toBeNull()
      cache.capture(fakeVideo, 0)
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.nearest(0)).toBeNull()
    })
  })
})
