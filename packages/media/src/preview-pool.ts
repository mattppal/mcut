import type { Input, VideoSampleSink } from 'mediabunny'
import type { FrameSource } from '@mcut/compositor'
import { PreviewAudio } from './preview-audio'
import { ScrubFrameCache } from './scrub-cache'
import { inputFor } from './probe'
import { sampleCanvas } from './sample-bitmap'
import { canUseNativeVideoPreview } from './video-capabilities'
import {
  assertNever,
  getRenderableElements,
  getSourceTimeMs,
  getSpeedAt,
  isAudioOnlySource,
  isMediaClip,
  type AssetId,
  type AssetRef,
  type MediaClip,
  type Project,
} from '@mcut/timeline'

export interface ActiveMediaItem {
  assetId: AssetId
  sourceTimeMs: number
  rate: number
  reversed?: boolean
}

function videoFeeds(project: Project, clip: MediaClip): { assetId: AssetId; offsetMs: number }[] {
  switch (clip.type) {
    case 'video':
      return [{ assetId: clip.assetId, offsetMs: 0 }]
    case 'audio':
      return []
    case 'multicam':
      return clip.sources.filter((source) => !isAudioOnlySource(project, source)).map((source) => ({ assetId: source.assetId, offsetMs: source.offsetMs }))
    default:
      return assertNever(clip)
  }
}

export function getActiveMediaItems(project: Project, timeMs: number): ActiveMediaItem[] {
  const items: ActiveMediaItem[] = []
  for (const { track, element } of getRenderableElements(project, timeMs)) {
    if (!isMediaClip(element) || track.hidden) continue
    const localMs = timeMs - element.startMs
    const groupMs = getSourceTimeMs(element, localMs)
    for (const feed of videoFeeds(project, element)) {
      items.push({
        assetId: feed.assetId,
        sourceTimeMs: Math.max(0, feed.offsetMs + groupMs),
        rate: getSpeedAt(element, localMs),
        ...(element.reversed ? { reversed: true } : {}),
      })
    }
  }
  return items
}

export interface PreviewSyncOptions {
  isPlaying: boolean
  playbackRate: number
}

const MAX_CATCHUP_DRIFT_S = 1
const MIN_CATCHUP_DRIFT_S = 0.05
const CATCHUP_RATE_MAX_BIAS = 1.5
const CATCHUP_RATE_MIN_BIAS = 0.75
const PAUSED_DRIFT_TOLERANCE_S = 0.04
const DECODED_FRAME_STEP_MS = 100
const DECODED_FRAME_NEARBY_MS = 750
const MAX_SEEK_LEAD_S = 2
const STUCK_SEEK_MS = 4000
const RECOVERY_INTERVAL_MS = 3000
const DECODED_INIT_RETRY_MS = 3000

interface DecodedVideoState {
  src: string | null
  input: Input | null
  sink: VideoSampleSink | null
  frames: Map<number, CanvasImageSource>
  pendingKey: number | null
  failed: boolean
  lastInitFailureAt: number
}

function decodedFrameKey(sourceTimeMs: number): number {
  return Math.max(0, Math.round(sourceTimeMs / DECODED_FRAME_STEP_MS) * DECODED_FRAME_STEP_MS)
}

interface PooledMedia {
  el: HTMLVideoElement
  src: string
  seekStartedAt: number | null
  seekLatencyS: number
  lastRecoveryAt: number
}

export class PreviewMediaPool implements FrameSource {
  private media = new Map<AssetId, PooledMedia>()
  private images = new Map<AssetId, ImageBitmap | 'loading' | 'error'>()
  private scrubCaches = new Map<AssetId, ScrubFrameCache>()
  private decodedVideos = new Map<AssetId, DecodedVideoState>()
  private disposed = false
  private playing = false
  private frameChanges = 0

  readonly audio = new PreviewAudio()

  constructor(private resolveAsset: (assetId: AssetId) => AssetRef | undefined) {}

  get frameVersion(): number {
    return this.frameChanges
  }

  private readonly markFrameChanged = (): void => {
    this.frameChanges++
  }

  getFrame(assetId: AssetId, sourceTimeMs: number): CanvasImageSource | null {
    const asset = this.resolveAsset(assetId)
    if (!asset) return null

    if (asset.kind === 'image') {
      const cached = this.images.get(assetId)
      if (cached === undefined) {
        this.loadImage(assetId, asset.src)
        return null
      }
      return cached instanceof ImageBitmap ? cached : null
    }

    if (asset.kind === 'video') {
      if (!canUseNativeVideoPreview(asset)) {
        return this.getDecodedVideoFrame(assetId, asset, sourceTimeMs)
      }
      const element = this.media.get(assetId)?.el
      if (!element) return null
      const cache = this.ensureScrubCache(assetId)
      const onFrame = element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !element.seeking
      if (onFrame) {
        cache.capture(element, element.currentTime * 1000)
        return element
      }
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.playing) {
        return element
      }
      const nearby = cache.nearest(sourceTimeMs)
      if (nearby) return nearby
      return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? element : null
    }
    return null
  }

  sync(items: ActiveMediaItem[], options: PreviewSyncOptions): void {
    if (this.disposed) return
    this.playing = options.isPlaying && options.playbackRate > 0
    const activeItems = new Map<AssetId, ActiveMediaItem>()
    for (const item of items) {
      if (!activeItems.has(item.assetId)) activeItems.set(item.assetId, item)
    }

    for (const [assetId, pooled] of this.media) {
      this.settleSeek(pooled)
      if (!activeItems.has(assetId) && !pooled.el.paused) pooled.el.pause()
    }

    for (const item of activeItems.values()) {
      const pooled = this.ensureVideoElement(item.assetId)
      if (pooled) this.followMediaClock(pooled, item, options)
    }
  }

  private followMediaClock(pooled: PooledMedia, item: ActiveMediaItem, options: PreviewSyncOptions): void {
    const element = pooled.el
    if (element.error) {
      this.recoverMediaElement(pooled)
      return
    }

    const targetSeconds = item.sourceTimeMs / 1000
    const frozen = item.rate <= 0.01
    const forwardRate = Math.max(0.0625, options.playbackRate * (frozen ? 1 : item.rate))

    // Negative playbackRate is unsupported per https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate so reversed items take the seek path
    if (options.isPlaying && options.playbackRate > 0 && !frozen && !item.reversed) {
      const drift = targetSeconds - element.currentTime
      let rate = forwardRate
      if (Math.abs(drift) > MAX_CATCHUP_DRIFT_S) {
        const lead = drift > 0 ? Math.min(MAX_SEEK_LEAD_S, pooled.seekLatencyS * forwardRate) : 0
        this.requestSeek(pooled, targetSeconds + lead)
      } else if (Math.abs(drift) > MIN_CATCHUP_DRIFT_S && !element.seeking) {
        rate = forwardRate * Math.min(CATCHUP_RATE_MAX_BIAS, Math.max(CATCHUP_RATE_MIN_BIAS, 1 + drift))
      }
      if (element.playbackRate !== rate) element.playbackRate = rate
      if (element.paused) {
        // Autoplay policy may reject play() until a user gesture, see https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
        element.play().catch(() => {})
      }
    } else {
      if (options.playbackRate > 0 && element.playbackRate !== forwardRate) {
        element.playbackRate = forwardRate
      }
      if (!element.paused) element.pause()
      const drift = Math.abs(element.currentTime - targetSeconds)
      if (drift > PAUSED_DRIFT_TOLERANCE_S) this.requestSeek(pooled, targetSeconds)
    }
  }

  private recoverMediaElement(pooled: PooledMedia): void {
    const now = performance.now()
    if (now - pooled.lastRecoveryAt < RECOVERY_INTERVAL_MS) return
    pooled.lastRecoveryAt = now
    pooled.el.load()
    pooled.seekStartedAt = null
  }

  private requestSeek(pooled: PooledMedia, targetSeconds: number): void {
    if (pooled.el.seeking) {
      const startedAt = pooled.seekStartedAt
      if (startedAt !== null && performance.now() - startedAt < STUCK_SEEK_MS) return
    }
    pooled.seekStartedAt = performance.now()
    pooled.el.currentTime = Math.max(0, targetSeconds)
    this.markFrameChanged()
  }

  private settleSeek(pooled: PooledMedia): void {
    if (pooled.seekStartedAt === null || pooled.el.seeking) return
    const latency = (performance.now() - pooled.seekStartedAt) / 1000
    pooled.seekLatencyS = pooled.seekLatencyS === 0 ? latency : pooled.seekLatencyS * 0.5 + latency * 0.5
    pooled.seekStartedAt = null
  }

  pauseAll(): void {
    for (const pooled of this.media.values()) {
      if (!pooled.el.paused) pooled.el.pause()
    }
  }

  dispose(): void {
    this.disposed = true
    this.audio.dispose()
    for (const pooled of this.media.values()) {
      pooled.el.pause()
      pooled.el.removeAttribute('src')
      pooled.el.load()
    }
    this.media.clear()
    for (const cache of this.scrubCaches.values()) cache.clear()
    this.scrubCaches.clear()
    for (const image of this.images.values()) {
      if (image instanceof ImageBitmap) image.close()
    }
    this.images.clear()
    for (const state of this.decodedVideos.values()) {
      state.input?.dispose()
      for (const frame of state.frames.values()) {
        if (typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap) frame.close()
      }
    }
    this.decodedVideos.clear()
  }

  private ensureScrubCache(assetId: AssetId): ScrubFrameCache {
    let cache = this.scrubCaches.get(assetId)
    if (!cache) {
      cache = new ScrubFrameCache()
      this.scrubCaches.set(assetId, cache)
    }
    return cache
  }

  private ensureVideoElement(assetId: AssetId): PooledMedia | null {
    const asset = this.resolveAsset(assetId)
    if (!asset || asset.kind !== 'video' || !canUseNativeVideoPreview(asset)) return null
    const existing = this.media.get(assetId)
    if (existing) {
      if (existing.src !== asset.src) {
        existing.src = asset.src
        existing.el.src = asset.src
        existing.el.load()
        existing.seekStartedAt = null
      }
      return existing
    }
    const element = document.createElement('video')
    element.src = asset.src
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    element.playsInline = true
    element.muted = true
    for (const type of ['loadeddata', 'seeked', 'emptied', 'error']) element.addEventListener(type, this.markFrameChanged)
    const pooled: PooledMedia = {
      el: element,
      src: asset.src,
      seekStartedAt: null,
      seekLatencyS: 0,
      lastRecoveryAt: 0,
    }
    this.media.set(assetId, pooled)
    return pooled
  }

  private getDecodedVideoFrame(assetId: AssetId, asset: AssetRef, sourceTimeMs: number): CanvasImageSource | null {
    const state = this.ensureDecodedVideoState(assetId, asset)
    if (state.failed) return null

    const key = decodedFrameKey(sourceTimeMs)
    const exact = state.frames.get(key)
    if (exact) return exact

    this.requestDecodedVideoFrame(assetId, asset, key)

    let nearest: { distance: number; frame: CanvasImageSource } | null = null
    for (const [frameKey, frame] of state.frames) {
      const distance = Math.abs(frameKey - sourceTimeMs)
      if (distance > DECODED_FRAME_NEARBY_MS) continue
      if (!nearest || distance < nearest.distance) nearest = { distance, frame }
    }
    return nearest?.frame ?? null
  }

  private ensureDecodedVideoState(assetId: AssetId, asset?: AssetRef): DecodedVideoState {
    let state = this.decodedVideos.get(assetId)
    if (state && asset && state.src !== null && state.src !== asset.src) {
      state.input?.dispose()
      for (const frame of state.frames.values()) {
        if (typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap) frame.close()
      }
      state = undefined
    }
    if (!state) {
      state = {
        src: asset?.src ?? null,
        input: null,
        sink: null,
        frames: new Map(),
        pendingKey: null,
        failed: false,
        lastInitFailureAt: Number.NEGATIVE_INFINITY,
      }
      this.decodedVideos.set(assetId, state)
    }
    return state
  }

  private requestDecodedVideoFrame(assetId: AssetId, asset: AssetRef, key: number): void {
    const state = this.ensureDecodedVideoState(assetId, asset)
    if (state.failed || state.pendingKey === key || state.frames.has(key)) return
    if (!state.sink && performance.now() - state.lastInitFailureAt < DECODED_INIT_RETRY_MS) return
    state.pendingKey = key

    void this.decodeVideoFrame(asset, key)
      .then((frame) => {
        if (this.disposed) return
        const current = this.decodedVideos.get(assetId)
        if (!current) return
        if (frame) {
          current.frames.set(key, frame)
          this.trimDecodedVideoFrames(current, key)
          this.markFrameChanged()
        }
      })
      .catch(() => {
        if (!this.disposed) setTimeout(this.markFrameChanged, DECODED_INIT_RETRY_MS)
      })
      .finally(() => {
        const current = this.decodedVideos.get(assetId)
        if (current?.pendingKey === key) current.pendingKey = null
      })
  }

  private async decodeVideoFrame(asset: AssetRef, sourceTimeMs: number): Promise<CanvasImageSource | null> {
    const state = this.ensureDecodedVideoState(asset.id, asset)
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

  private trimDecodedVideoFrames(state: DecodedVideoState, centerKey: number): void {
    if (state.frames.size <= 80) return
    const keep = new Set([...state.frames.keys()].sort((a, b) => Math.abs(a - centerKey) - Math.abs(b - centerKey)).slice(0, 60))
    for (const key of state.frames.keys()) {
      if (!keep.has(key)) state.frames.delete(key)
    }
  }

  private loadImage(assetId: AssetId, src: string): void {
    this.images.set(assetId, 'loading')
    fetch(src)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (this.disposed) {
          bitmap.close()
          return
        }
        this.images.set(assetId, bitmap)
        this.markFrameChanged()
      })
      .catch(() => {
        this.images.set(assetId, 'error')
        this.markFrameChanged()
      })
  }
}
