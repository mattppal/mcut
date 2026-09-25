import type { CanvasSink, Input } from 'mediabunny'
import type { FrameSource } from '@mcut/compositor'
import { ScrubFrameCache } from './scrub-cache'
import { inputFor } from './probe'
import { canUseNativeVideoPreview } from './video-capabilities'
import {
  getEffectiveVolume,
  getMulticamSourceTimeMs,
  getRenderableElements,
  getSourceTimeMs,
  getSpeedAt,
  isElementActiveAt,
  type AssetId,
  type AssetRef,
  type ElementId,
  type Project,
} from '@mcut/timeline'

export interface ActiveMediaItem {
  assetId: AssetId
  kind: 'video' | 'audio'
  sourceTimeMs: number
  rate: number
  volume: number
  reversed?: boolean
  audioSrc?: string
}

const SAME_SOURCE_TOLERANCE_MS = 40
const SAME_RATE_TOLERANCE = 0.001

function hasSameMediaClock(a: ActiveMediaItem, b: ActiveMediaItem): boolean {
  return (
    Math.abs(a.sourceTimeMs - b.sourceTimeMs) <= SAME_SOURCE_TOLERANCE_MS &&
    Math.abs(a.rate - b.rate) <= SAME_RATE_TOLERANCE &&
    Boolean(a.reversed) === Boolean(b.reversed)
  )
}

function mergeActiveMediaItems(current: ActiveMediaItem, next: ActiveMediaItem): ActiveMediaItem {
  const kind = current.kind === 'video' || next.kind === 'video' ? 'video' : 'audio'
  const currentAudible = current.volume > 0
  const nextAudible = next.volume > 0

  if (currentAudible && nextAudible) {
    const preferred = next.volume > current.volume ? next : current
    return {
      ...preferred,
      kind,
      volume: hasSameMediaClock(current, next) ? current.volume + next.volume : Math.max(current.volume, next.volume),
    }
  }

  if (nextAudible && !currentAudible) return { ...next, kind }
  if (currentAudible && !nextAudible) return { ...current, kind }
  if (current.kind !== 'video' && next.kind === 'video') return { ...next, kind }
  return { ...current, kind }
}

function coalesceKey(item: ActiveMediaItem): string {
  if (item.audioSrc === undefined) return item.assetId
  return `${item.assetId}\u0000${item.audioSrc}`
}

function stemPoolKey(assetId: AssetId, audioSrc: string): string {
  return `${assetId}\u0000${audioSrc}`
}

export function coalesceActiveMediaItems(items: ActiveMediaItem[]): ActiveMediaItem[] {
  const grouped = new Map<string, ActiveMediaItem>()
  for (const item of items) {
    const key = coalesceKey(item)
    const current = grouped.get(key)
    grouped.set(key, current ? mergeActiveMediaItems(current, item) : item)
  }
  return [...grouped.values()]
}

export function getActiveMediaItems(project: Project, timeMs: number, audioSources?: ReadonlyMap<ElementId, string>): ActiveMediaItem[] {
  const items: ActiveMediaItem[] = []
  for (const { track, element } of getRenderableElements(project, timeMs)) {
    const audioSrc = audioSources?.get(element.id)
    const replacement = audioSrc ? { audioSrc } : {}
    if (element.type === 'multicam') {
      const audible = isElementActiveAt(element, timeMs)
      const speedShim = {
        startMs: element.startMs,
        durationMs: element.durationMs,
        trimStartMs: 0,
        timeMap: element.timeMap,
      }
      for (const source of element.sources) {
        const isAudio = source.key === element.audioSource
        items.push({
          assetId: source.assetId,
          kind: 'video',
          sourceTimeMs: getMulticamSourceTimeMs(element, source, timeMs),
          rate: getSpeedAt(speedShim, timeMs - element.startMs),
          volume: isAudio && audible && !track.muted && !element.muted ? getEffectiveVolume(element, timeMs) : 0,
          ...(isAudio ? replacement : {}),
        })
      }
      continue
    }
    if (element.type !== 'video' && element.type !== 'audio') continue
    if (element.type === 'video' && track.hidden && (track.muted || element.muted)) continue
    const localMs = timeMs - element.startMs
    const audible = isElementActiveAt(element, timeMs)
    if (element.type === 'audio' && !audible) continue
    items.push({
      assetId: element.assetId,
      kind: element.type,
      sourceTimeMs: Math.max(0, getSourceTimeMs(element, localMs)),
      rate: getSpeedAt(element, localMs),
      volume: !audible || track.muted || element.muted || element.reversed ? 0 : getEffectiveVolume(element, timeMs),
      ...(element.reversed ? { reversed: true } : {}),
      ...replacement,
    })
  }
  return items
}

export interface PreviewSyncOptions {
  isPlaying: boolean
  playbackRate: number
  masterVolume: number
  muted: boolean
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
  sink: CanvasSink | null
  frames: Map<number, CanvasImageSource>
  pendingKey: number | null
  failed: boolean
  lastInitFailureAt: number
}

function decodedFrameKey(sourceTimeMs: number): number {
  return Math.max(0, Math.round(sourceTimeMs / DECODED_FRAME_STEP_MS) * DECODED_FRAME_STEP_MS)
}

interface PooledMedia {
  el: HTMLVideoElement | HTMLAudioElement
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
  private stemAudio = new Map<string, PooledMedia>()
  private audioSources: ReadonlyMap<ElementId, string> | undefined
  private disposed = false
  private playing = false

  constructor(private resolveAsset: (assetId: AssetId) => AssetRef | undefined) {}

  setAudioSources(sources: ReadonlyMap<ElementId, string> | undefined): void {
    this.audioSources = sources
  }

  getAudioSources(): ReadonlyMap<ElementId, string> | undefined {
    return this.audioSources
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
      if (!(element instanceof HTMLVideoElement)) return null
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
    const activeItems = coalesceActiveMediaItems(items)
    const activeIds = new Set(activeItems.map((item) => item.assetId))
    const activeStemKeys = new Set<string>()
    for (const item of activeItems) {
      if (item.audioSrc) activeStemKeys.add(stemPoolKey(item.assetId, item.audioSrc))
    }

    for (const [assetId, pooled] of this.media) {
      this.settleSeek(pooled)
      if (!activeIds.has(assetId) && !pooled.el.paused) pooled.el.pause()
    }
    this.releaseInactiveStems(activeStemKeys)

    for (const item of activeItems) {
      const pooled = this.ensureMediaElement(item.assetId, item.kind)
      if (!pooled) continue
      this.followMediaClock(pooled, item, options, pooled.src, !item.audioSrc)
      if (!item.audioSrc) continue
      const stem = this.ensureStemAudio(item.assetId, item.audioSrc)
      this.followMediaClock(stem, item, options, item.audioSrc, true)
    }
  }

  private followMediaClock(pooled: PooledMedia, item: ActiveMediaItem, options: PreviewSyncOptions, src: string, playAudio: boolean): void {
    const element = pooled.el
    if (element.error) {
      this.recoverMediaElement(pooled, src)
      return
    }

    const targetSeconds = item.sourceTimeMs / 1000
    element.volume = playAudio ? Math.max(0, Math.min(1, item.volume * options.masterVolume)) : 0
    element.muted = !playAudio || options.muted || item.volume <= 0
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

  private recoverMediaElement(pooled: PooledMedia, src: string): void {
    const now = performance.now()
    if (now - pooled.lastRecoveryAt < RECOVERY_INTERVAL_MS) return
    pooled.lastRecoveryAt = now
    if (pooled.src !== src) {
      pooled.src = src
      pooled.el.src = src
    }
    pooled.el.load()
    pooled.seekStartedAt = null
  }

  private ensureStemAudio(assetId: AssetId, audioSrc: string): PooledMedia {
    const key = stemPoolKey(assetId, audioSrc)
    const existing = this.stemAudio.get(key)
    if (existing) return existing
    const element = document.createElement('audio')
    element.src = audioSrc
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    const pooled: PooledMedia = {
      el: element,
      src: audioSrc,
      seekStartedAt: null,
      seekLatencyS: 0,
      lastRecoveryAt: 0,
    }
    this.stemAudio.set(key, pooled)
    return pooled
  }

  private releaseInactiveStems(activeKeys: ReadonlySet<string>): void {
    for (const [key, pooled] of this.stemAudio) {
      this.settleSeek(pooled)
      if (activeKeys.has(key)) continue
      if (!pooled.el.paused) pooled.el.pause()
      pooled.el.removeAttribute('src')
      pooled.el.load()
      this.stemAudio.delete(key)
    }
  }

  private forEachPooled(visit: (pooled: PooledMedia) => void): void {
    for (const pooled of this.media.values()) visit(pooled)
    for (const pooled of this.stemAudio.values()) visit(pooled)
  }

  private requestSeek(pooled: PooledMedia, targetSeconds: number): void {
    if (pooled.el.seeking) {
      const startedAt = pooled.seekStartedAt
      if (startedAt !== null && performance.now() - startedAt < STUCK_SEEK_MS) return
    }
    pooled.seekStartedAt = performance.now()
    pooled.el.currentTime = Math.max(0, targetSeconds)
  }

  private settleSeek(pooled: PooledMedia): void {
    if (pooled.seekStartedAt === null || pooled.el.seeking) return
    const latency = (performance.now() - pooled.seekStartedAt) / 1000
    pooled.seekLatencyS = pooled.seekLatencyS === 0 ? latency : pooled.seekLatencyS * 0.5 + latency * 0.5
    pooled.seekStartedAt = null
  }

  pauseAll(): void {
    this.forEachPooled((pooled) => {
      if (!pooled.el.paused) pooled.el.pause()
    })
  }

  dispose(): void {
    this.disposed = true
    this.forEachPooled((pooled) => {
      pooled.el.pause()
      pooled.el.removeAttribute('src')
      pooled.el.load()
    })
    this.media.clear()
    this.stemAudio.clear()
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

  private ensureMediaElement(assetId: AssetId, kind: 'video' | 'audio'): PooledMedia | null {
    const asset = this.resolveAsset(assetId)
    if (!asset) return null
    let existing = this.media.get(assetId)
    const audioOnly = kind === 'video' && !canUseNativeVideoPreview(asset)
    const wantsVideoElement = kind === 'video' && !audioOnly
    if (existing) {
      const existingIsVideo = existing.el instanceof HTMLVideoElement
      if ((wantsVideoElement && !existingIsVideo) || (audioOnly && existingIsVideo)) {
        existing.el.pause()
        existing.el.removeAttribute('src')
        existing.el.load()
        this.media.delete(assetId)
        existing = undefined
      }
    }
    if (existing) {
      if (existing.src !== asset.src) {
        existing.src = asset.src
        existing.el.src = asset.src
        existing.el.load()
        existing.seekStartedAt = null
      }
      return existing
    }
    const element = kind === 'video' && !audioOnly ? document.createElement('video') : document.createElement('audio')
    element.src = asset.src
    element.preload = 'auto'
    element.crossOrigin = 'anonymous'
    if (element instanceof HTMLVideoElement) {
      element.playsInline = true
      element.muted = true
    }
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
        lastInitFailureAt: 0,
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
        }
      })
      .catch(() => {})
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
        const { CanvasSink } = await import('mediabunny')
        state.sink = new CanvasSink(track, {
          width: Math.min(1280, asset.width ?? 1280),
          fit: 'contain',
        })
        state.input = input
      } catch (error) {
        state.lastInitFailureAt = performance.now()
        input.dispose()
        throw error
      }
    }
    const wrapped = await state.sink.getCanvas(sourceTimeMs / 1000)
    return wrapped?.canvas ?? null
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
      })
      .catch(() => {
        this.images.set(assetId, 'error')
      })
  }
}
