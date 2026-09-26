import type { Input, VideoSampleSink } from 'mediabunny'
import type { AssetId, AssetRef } from '@mcut/timeline'
import { inputFor } from './probe'
import { sampleCanvas } from './sample-bitmap'

const FRAME_STEP_MS = 100
const NEARBY_MS = 750
const INIT_RETRY_MS = 3000
const TRIM_ABOVE = 80
const TRIM_TO = 60

interface DecodedVideoState {
  src: string
  input: Input | null
  sink: VideoSampleSink | null
  frames: Map<number, CanvasImageSource>
  pendingKey: number | null
  failed: boolean
  lastInitFailureAt: number
}

function frameKey(sourceTimeMs: number): number {
  return Math.max(0, Math.round(sourceTimeMs / FRAME_STEP_MS) * FRAME_STEP_MS)
}

function closeFrames(state: DecodedVideoState): void {
  state.input?.dispose()
  for (const frame of state.frames.values()) {
    if (typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap) frame.close()
  }
}

export class DecodedVideoFrames {
  private videos = new Map<AssetId, DecodedVideoState>()
  private disposed = false

  constructor(private onFrame: () => void) {}

  getFrame(assetId: AssetId, asset: AssetRef, sourceTimeMs: number): CanvasImageSource | null {
    const state = this.stateOf(assetId, asset)
    if (state.failed) return null

    const key = frameKey(sourceTimeMs)
    const exact = state.frames.get(key)
    if (exact) return exact

    this.request(assetId, asset, key)

    let nearest: { distance: number; frame: CanvasImageSource } | null = null
    for (const [candidate, frame] of state.frames) {
      const distance = Math.abs(candidate - sourceTimeMs)
      if (distance > NEARBY_MS) continue
      if (!nearest || distance < nearest.distance) nearest = { distance, frame }
    }
    return nearest?.frame ?? null
  }

  dispose(): void {
    this.disposed = true
    for (const state of this.videos.values()) closeFrames(state)
    this.videos.clear()
  }

  private stateOf(assetId: AssetId, asset: AssetRef): DecodedVideoState {
    let state = this.videos.get(assetId)
    if (state && state.src !== asset.src) {
      closeFrames(state)
      state = undefined
    }
    if (!state) {
      state = {
        src: asset.src,
        input: null,
        sink: null,
        frames: new Map(),
        pendingKey: null,
        failed: false,
        lastInitFailureAt: Number.NEGATIVE_INFINITY,
      }
      this.videos.set(assetId, state)
    }
    return state
  }

  private request(assetId: AssetId, asset: AssetRef, key: number): void {
    const state = this.stateOf(assetId, asset)
    if (state.failed || state.pendingKey === key || state.frames.has(key)) return
    if (!state.sink && performance.now() - state.lastInitFailureAt < INIT_RETRY_MS) return
    state.pendingKey = key

    void this.decode(assetId, asset, key)
      .then((frame) => {
        if (this.disposed) return
        const current = this.videos.get(assetId)
        if (!current || !frame) return
        current.frames.set(key, frame)
        this.trim(current, key)
        this.onFrame()
      })
      .catch(() => {
        if (!this.disposed) setTimeout(this.onFrame, INIT_RETRY_MS)
      })
      .finally(() => {
        const current = this.videos.get(assetId)
        if (current?.pendingKey === key) current.pendingKey = null
      })
  }

  private async decode(assetId: AssetId, asset: AssetRef, sourceTimeMs: number): Promise<CanvasImageSource | null> {
    const state = this.stateOf(assetId, asset)
    if (!state.sink) {
      const input = await inputFor(asset.src)
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) {
          state.failed = true
          input.dispose()
          return null
        }
        const { VideoSampleSink } = await import('mediabunny')
        state.sink = new VideoSampleSink(track)
        state.input = input
      } catch (error) {
        state.lastInitFailureAt = performance.now()
        input.dispose()
        throw error
      }
    }
    const sample = await state.sink.getSample(sourceTimeMs / 1000)
    return sample ? await sampleCanvas(sample, Math.min(1280, asset.width ?? 1280), 'contain') : null
  }

  private trim(state: DecodedVideoState, centerKey: number): void {
    if (state.frames.size <= TRIM_ABOVE) return
    const keep = new Set([...state.frames.keys()].sort((a, b) => Math.abs(a - centerKey) - Math.abs(b - centerKey)).slice(0, TRIM_TO))
    for (const key of state.frames.keys()) {
      if (!keep.has(key)) state.frames.delete(key)
    }
  }
}
