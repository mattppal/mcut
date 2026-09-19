import { valueAt } from './value-at'

interface CachedFrame {
  timeMs: number
  canvas: OffscreenCanvas
}

const MAX_FRAME_AREA = 331_776

export class ScrubFrameCache {
  private frames: CachedFrame[] = []
  private order: CachedFrame[] = []

  constructor(
    private maxFrames = 150,
    private minGapMs = 90,
  ) {}

  capture(source: HTMLVideoElement, timeMs: number): void {
    if (typeof OffscreenCanvas === 'undefined') return
    const sw = source.videoWidth
    const sh = source.videoHeight
    if (sw <= 0 || sh <= 0) return
    const index = this.indexAtOrAfter(timeMs)
    const before = this.frames[index - 1]
    const at = this.frames[index]
    if ((before && timeMs - before.timeMs < this.minGapMs) || (at && at.timeMs - timeMs < this.minGapMs)) {
      return
    }
    const scale = Math.min(1, Math.sqrt(MAX_FRAME_AREA / (sw * sh)))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    } catch {
      return
    }
    const frame: CachedFrame = { timeMs, canvas }
    this.frames.splice(index, 0, frame)
    this.order.push(frame)
    for (const evicted of this.order.splice(0, Math.max(0, this.order.length - this.maxFrames))) {
      const i = this.frames.indexOf(evicted)
      if (i !== -1) this.frames.splice(i, 1)
    }
  }

  nearest(timeMs: number): OffscreenCanvas | null {
    const index = this.indexAtOrAfter(timeMs)
    const before = this.frames[index - 1]
    const at = this.frames[index]
    if (before && at) return timeMs - before.timeMs <= at.timeMs - timeMs ? before.canvas : at.canvas
    return (before ?? at)?.canvas ?? null
  }

  get size(): number {
    return this.frames.length
  }

  clear(): void {
    this.frames = []
    this.order = []
  }

  private indexAtOrAfter(timeMs: number): number {
    let lo = 0
    let hi = this.frames.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (valueAt(this.frames, mid).timeMs < timeMs) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
