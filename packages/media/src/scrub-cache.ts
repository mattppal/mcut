/**
 * Scrub frame cache (Diffusion Studio's recipe): a binary-searched ring of
 * downscaled frames captured opportunistically while a media element plays
 * or sits on a decoded frame. While the element is mid-seek the preview
 * serves the nearest cached frame instead of flashing black/stale — preview
 * never blocks on decode.
 */

interface CachedFrame {
  timeMs: number
  canvas: OffscreenCanvas
}

/** ≈576² area cap per cached frame — small enough to keep 150 around. */
const MAX_FRAME_AREA = 331_776

export class ScrubFrameCache {
  /** Sorted by timeMs for binary search. */
  private frames: CachedFrame[] = []
  /** Insertion order for FIFO eviction. */
  private order: CachedFrame[] = []

  constructor(
    private maxFrames = 150,
    /** Frames closer together than this are considered duplicates. */
    private minGapMs = 90,
  ) {}

  /** Capture the element's current frame if this instant isn't cached yet. */
  capture(source: HTMLVideoElement, timeMs: number): void {
    if (typeof OffscreenCanvas === 'undefined') return
    const sw = source.videoWidth
    const sh = source.videoHeight
    if (sw <= 0 || sh <= 0) return
    const index = this.indexAtOrAfter(timeMs)
    const before = this.frames[index - 1]
    const at = this.frames[index]
    if (
      (before && timeMs - before.timeMs < this.minGapMs) ||
      (at && at.timeMs - timeMs < this.minGapMs)
    ) {
      return
    }
    const scale = Math.min(1, Math.sqrt(MAX_FRAME_AREA / (sw * sh)))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    } catch {
      return // tainted or decode error: skip
    }
    const frame: CachedFrame = { timeMs, canvas }
    this.frames.splice(index, 0, frame)
    this.order.push(frame)
    if (this.order.length > this.maxFrames) {
      const evicted = this.order.shift()!
      const i = this.frames.indexOf(evicted)
      if (i !== -1) this.frames.splice(i, 1)
    }
  }

  /** The cached frame nearest `timeMs`, or null when the cache is empty. */
  nearest(timeMs: number): OffscreenCanvas | null {
    if (this.frames.length === 0) return null
    const index = this.indexAtOrAfter(timeMs)
    const before = this.frames[index - 1]
    const at = this.frames[index]
    if (!before) return at!.canvas
    if (!at) return before.canvas
    return timeMs - before.timeMs <= at.timeMs - timeMs ? before.canvas : at.canvas
  }

  get size(): number {
    return this.frames.length
  }

  clear(): void {
    this.frames = []
    this.order = []
  }

  /** First index whose frame time is >= timeMs. */
  private indexAtOrAfter(timeMs: number): number {
    let lo = 0
    let hi = this.frames.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.frames[mid]!.timeMs < timeMs) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
