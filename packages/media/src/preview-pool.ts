import type { FrameSource } from '@mcut/compositor'
import { DecodedVideoFrames } from './decoded-video-frames'
import { PreviewAudio } from './preview-audio'
import { ScrubFrameCache } from './scrub-cache'
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
const MIN_CATCHUP_DRIFT_S = 0.01
const CATCHUP_GAIN = 4
const CATCHUP_RATE_MAX_BIAS = 1.5
const CATCHUP_RATE_MIN_BIAS = 0.75
const PAUSED_DRIFT_TOLERANCE_S = 0.04
const MAX_SEEK_LEAD_S = 2
const STUCK_SEEK_MS = 4000
const RECOVERY_INTERVAL_MS = 3000

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
  private disposed = false
  private playing = false
  private frameChanges = 0

  private readonly markFrameChanged = (): void => {
    this.frameChanges++
  }

  private readonly decoded = new DecodedVideoFrames(this.markFrameChanged)

  readonly audio = new PreviewAudio()

  constructor(private resolveAsset: (assetId: AssetId) => AssetRef | undefined) {}

  get frameVersion(): number {
    return this.frameChanges
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
        return this.decoded.getFrame(assetId, asset, sourceTimeMs)
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
        rate = forwardRate * Math.min(CATCHUP_RATE_MAX_BIAS, Math.max(CATCHUP_RATE_MIN_BIAS, 1 + drift * CATCHUP_GAIN))
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
    this.decoded.dispose()
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
