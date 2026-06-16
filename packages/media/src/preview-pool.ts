import { CanvasSink } from 'mediabunny'
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
  type Project,
} from '@mcut/timeline'

export interface ActiveMediaItem {
  assetId: AssetId
  kind: 'video' | 'audio'
  /** Media-local time (after trim and time remap). */
  sourceTimeMs: number
  /** Element playback speed at the playhead (timeMap slope; 1 unmapped, 0 frozen). */
  rate: number
  /** Effective volume (element volume × fades; 0 when element/track muted). */
  volume: number
  /**
   * The element plays its source backward. Media elements reject negative
   * rates, so the pool seek-chases these like a scrub (frames come from the
   * scrub cache) and their preview audio is muted; export is exact.
   */
  reversed?: boolean
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
      volume: hasSameMediaClock(current, next)
        ? current.volume + next.volume
        : Math.max(current.volume, next.volume),
    }
  }

  if (nextAudible && !currentAudible) return { ...next, kind }
  if (currentAudible && !nextAudible) return { ...current, kind }
  if (current.kind !== 'video' && next.kind === 'video') return { ...next, kind }
  return { ...current, kind }
}

/**
 * The pool has one native media element per asset. Collapse duplicate active
 * references so muted transition/visual items do not fight audible timeline
 * items over volume, rate, and currentTime in the same animation frame.
 */
export function coalesceActiveMediaItems(items: ActiveMediaItem[]): ActiveMediaItem[] {
  const byAsset = new Map<AssetId, ActiveMediaItem>()
  for (const item of items) {
    const current = byAsset.get(item.assetId)
    byAsset.set(item.assetId, current ? mergeActiveMediaItems(current, item) : item)
  }
  return [...byAsset.values()]
}

/** The media items the preview pool should have live at `timeMs`. */
export function getActiveMediaItems(project: Project, timeMs: number): ActiveMediaItem[] {
  const items: ActiveMediaItem[] = []
  // Renderable enumeration includes transition partners pre-rolling /
  // extending past their range; those contribute frames but no audio.
  for (const { track, element } of getRenderableElements(project, timeMs)) {
    if (element.type === 'multicam') {
      // Keep EVERY source warm (not just the active layout's) so switching
      // layouts mid-playback is instant; audio comes from audioSource only.
      const audible = isElementActiveAt(element, timeMs)
      // getSpeedAt only reads duration/timeMap; multicam trims are per-source.
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
          volume:
            isAudio && audible && !track.muted && !element.muted
              ? getEffectiveVolume(element, timeMs)
              : 0,
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
      // Animated volume + fades resolve per tick; static elements pass
      // through. Reversed clips are muted in preview (no backward playback
      // through media elements); the export mix renders them exactly.
      volume:
        !audible || track.muted || element.muted || element.reversed
          ? 0
          : getEffectiveVolume(element, timeMs),
      ...(element.reversed ? { reversed: true } : {}),
    })
  }
  return items
}

export interface PreviewSyncOptions {
  isPlaying: boolean
  playbackRate: number
  /** Global volume multiplier (0–1). */
  masterVolume: number
  muted: boolean
}

/**
 * Playing drift the rate bias absorbs; beyond this we re-seek. Re-seeking a
 * long-GOP source decodes from the previous keyframe, so chasing the playhead
 * with seeks degrades playback to blurry scrub-cache frames — within this
 * window a speed bias converges without ever interrupting decode.
 */
const MAX_CATCHUP_DRIFT_S = 1
/** Drift below this is noise (≈1 frame); don't bias the rate for it. */
const MIN_CATCHUP_DRIFT_S = 0.05
const CATCHUP_RATE_MAX_BIAS = 1.5
const CATCHUP_RATE_MIN_BIAS = 0.75
/** Drift beyond which a paused media element gets re-seeked (scrubbing). */
const PAUSED_DRIFT_TOLERANCE_S = 0.04
const DECODED_FRAME_STEP_MS = 100
const DECODED_FRAME_NEARBY_MS = 750
/** Upper bound on the predictive seek lead (runaway-estimate guard). */
const MAX_SEEK_LEAD_S = 2
/** A seek in flight this long is wedged (lost decoder, dead src); re-issue. */
const STUCK_SEEK_MS = 4000
/** Minimum spacing between load() recovery attempts on an errored element. */
const RECOVERY_INTERVAL_MS = 3000
/** Back-off before re-trying a failed decoded-path (CanvasSink) init. */
const DECODED_INIT_RETRY_MS = 3000

interface DecodedVideoState {
  /** The asset src the input was opened from — rebuild when relinked. */
  src: string | null
  input: ReturnType<typeof inputFor> | null
  sink: CanvasSink | null
  frames: Map<number, CanvasImageSource>
  pendingKey: number | null
  failed: boolean
  /** performance.now() of the last failed sink init, 0 when none. */
  lastInitFailureAt: number
}

function decodedFrameKey(sourceTimeMs: number): number {
  return Math.max(0, Math.round(sourceTimeMs / DECODED_FRAME_STEP_MS) * DECODED_FRAME_STEP_MS)
}

interface PooledMedia {
  el: HTMLVideoElement | HTMLAudioElement
  /** The asset src the element was loaded from — reload when relinked. */
  src: string
  /** performance.now() when the in-flight seek was issued, null when idle. */
  seekStartedAt: number | null
  /** EMA of recent seek latencies (seconds); 0 until first measurement. */
  seekLatencyS: number
  /** performance.now() of the last load() recovery attempt, 0 when none. */
  lastRecoveryAt: number
}

/**
 * The approximate, low-latency {@link FrameSource} used for interactive
 * preview: one pooled `<video>`/`<audio>` element per media asset, kept in
 * sync with the playback clock, plus decoded `ImageBitmap`s for images.
 * Audio plays through the media elements themselves (no Web Audio graph);
 * the deterministic export pipeline is a separate implementation.
 *
 * Known approximation: two simultaneously-active elements sharing one asset
 * share one media element, so they render the same source frame.
 */
export class PreviewMediaPool implements FrameSource {
  private media = new Map<AssetId, PooledMedia>()
  private images = new Map<AssetId, ImageBitmap | 'loading' | 'error'>()
  private scrubCaches = new Map<AssetId, ScrubFrameCache>()
  private decodedVideos = new Map<AssetId, DecodedVideoState>()
  private disposed = false
  /** Transport state from the last sync(); steers mid-seek frame choice. */
  private playing = false

  constructor(private resolveAsset: (assetId: AssetId) => AssetRef | undefined) {}

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
      const onFrame =
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !element.seeking
      if (onFrame) {
        // Opportunistic capture: playback and settled seeks feed the cache.
        cache.capture(element, element.currentTime * 1000)
        return element
      }
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.playing) {
        // Mid-seek while playing: the element's last decoded frame (full
        // resolution, monotonic) beats a downscaled cache frame that can
        // jump backwards in time — that read as flicker/jitter.
        return element
      }
      // Mid-seek (scrubbing): nearest cached frame beats a stale/black frame.
      const nearby = cache.nearest(sourceTimeMs)
      if (nearby) return nearby
      return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? element : null
    }
    return null
  }

  /**
   * Reconcile pooled media elements with the items active under the
   * playhead. Called by the playback loop every frame and on seeks.
   */
  sync(items: ActiveMediaItem[], options: PreviewSyncOptions): void {
    if (this.disposed) return
    this.playing = options.isPlaying && options.playbackRate > 0
    const activeItems = coalesceActiveMediaItems(items)
    const activeIds = new Set(activeItems.map((item) => item.assetId))

    for (const [assetId, pooled] of this.media) {
      this.settleSeek(pooled)
      if (!activeIds.has(assetId) && !pooled.el.paused) pooled.el.pause()
    }

    for (const item of activeItems) {
      const pooled = this.ensureMediaElement(item.assetId, item.kind)
      if (!pooled) continue
      const element = pooled.el

      if (element.error) {
        // An errored element never recovers on its own (lost decoder after
        // sleep/GPU restart, revoked blob URL) — without this the preview
        // stays black until a hard refresh.
        this.recoverMediaElement(item.assetId, pooled)
        continue
      }

      const targetSeconds = item.sourceTimeMs / 1000
      element.volume = Math.max(0, Math.min(1, item.volume * options.masterVolume))
      element.muted = options.muted || item.volume <= 0
      // Media elements reject negative rates; reverse shuttle scrubs instead.
      // Element speed (timeMap slope) compounds with the transport rate.
      const frozen = item.rate <= 0.01
      const forwardRate = Math.max(0.0625, options.playbackRate * (frozen ? 1 : item.rate))

      // Reversed elements take the paused path even while playing: the
      // element can't run backward, so we seek-chase the (decreasing) target
      // and getFrame serves scrub-cache frames between landings.
      if (options.isPlaying && options.playbackRate > 0 && !frozen && !item.reversed) {
        // Signed: positive when the element is behind the playhead.
        const drift = targetSeconds - element.currentTime
        let rate = forwardRate
        if (Math.abs(drift) > MAX_CATCHUP_DRIFT_S) {
          // Lead the target by the measured seek latency so the element lands
          // in sync instead of perpetually behind (long-GOP seeks can take
          // longer than the drift tolerance — chasing "now" never converges).
          const lead = drift > 0 ? Math.min(MAX_SEEK_LEAD_S, pooled.seekLatencyS * forwardRate) : 0
          this.requestSeek(pooled, targetSeconds + lead)
        } else if (Math.abs(drift) > MIN_CATCHUP_DRIFT_S && !element.seeking) {
          rate =
            forwardRate *
            Math.min(CATCHUP_RATE_MAX_BIAS, Math.max(CATCHUP_RATE_MIN_BIAS, 1 + drift))
        }
        if (element.playbackRate !== rate) element.playbackRate = rate
        if (element.paused) {
          element.play().catch(() => {
            // Autoplay restrictions: stay paused; the next user gesture retries.
          })
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
  }

  /** Reload an errored element from the asset's current src, rate-limited. */
  private recoverMediaElement(assetId: AssetId, pooled: PooledMedia): void {
    const now = performance.now()
    if (now - pooled.lastRecoveryAt < RECOVERY_INTERVAL_MS) return
    pooled.lastRecoveryAt = now
    const asset = this.resolveAsset(assetId)
    if (!asset) return
    if (pooled.src !== asset.src) {
      pooled.src = asset.src
      pooled.el.src = asset.src
    }
    pooled.el.load()
    pooled.seekStartedAt = null
  }

  /**
   * Seek unless one is already in flight. Restarting an in-flight seek aborts
   * its decode, and on long-GOP sources (seek latency above the drift
   * tolerance) that loops forever: no seek ever completes, playback degrades
   * to scrub-cache frames, and a paused preview can stay black. Letting the
   * seek land also coalesces scrubbing to the latest playhead position.
   */
  private requestSeek(pooled: PooledMedia, targetSeconds: number): void {
    if (pooled.el.seeking) {
      // A seek that never settles (decoder lost mid-seek, detached src)
      // would otherwise block every future seek — preview black until
      // reload. Past the watchdog, abort it by re-issuing.
      const startedAt = pooled.seekStartedAt
      if (startedAt !== null && performance.now() - startedAt < STUCK_SEEK_MS) return
    }
    pooled.seekStartedAt = performance.now()
    pooled.el.currentTime = Math.max(0, targetSeconds)
  }

  /** Fold a completed seek into the element's latency estimate. */
  private settleSeek(pooled: PooledMedia): void {
    if (pooled.seekStartedAt === null || pooled.el.seeking) return
    const latency = (performance.now() - pooled.seekStartedAt) / 1000
    pooled.seekLatencyS = pooled.seekLatencyS === 0 ? latency : pooled.seekLatencyS * 0.5 + latency * 0.5
    pooled.seekStartedAt = null
  }

  /** Pause everything (e.g. when the player unmounts a project). */
  pauseAll(): void {
    for (const { el } of this.media.values()) {
      if (!el.paused) el.pause()
    }
  }

  dispose(): void {
    this.disposed = true
    for (const { el } of this.media.values()) {
      el.pause()
      el.removeAttribute('src')
      el.load()
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
        // `src` is a runtime binding: object URLs are recreated on restore /
        // relink. Follow it instead of serving a dead blob URL forever.
        existing.src = asset.src
        existing.el.src = asset.src
        existing.el.load()
        existing.seekStartedAt = null
      }
      return existing
    }
    // Decoded-path assets (MKV, persisted nativePreview:false) get an
    // <audio> element: frames come from the decoded path, but the browser
    // can usually still demux the soundtrack natively — without a pooled
    // element these clips play silent. A truly unplayable container just
    // errors and stays silent, as before.
    const element =
      kind === 'video' && !audioOnly
        ? document.createElement('video')
        : document.createElement('audio')
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

  private getDecodedVideoFrame(
    assetId: AssetId,
    asset: AssetRef,
    sourceTimeMs: number,
  ): CanvasImageSource | null {
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
      // Relinked to a fresh object URL: the old input is dead. Rebuild.
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
    // Failed sink init (transient read error): back off instead of retrying
    // every frame — but do retry, or the preview is black until reload.
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
      .catch(() => {
        // A bad seek near EOF should not permanently disable future frames.
      })
      .finally(() => {
        const current = this.decodedVideos.get(assetId)
        if (current?.pendingKey === key) current.pendingKey = null
      })
  }

  private async decodeVideoFrame(
    asset: AssetRef,
    sourceTimeMs: number,
  ): Promise<CanvasImageSource | null> {
    const state = this.ensureDecodedVideoState(asset.id, asset)
    if (!state.sink) {
      // Commit input/sink only on success — a half-initialized state (input
      // set, sink null) would return null frames forever with no retry.
      const input = inputFor(asset.src)
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) {
          state.failed = true
          console.warn(
            `[mcut] no WebCodecs decoder for "${asset.name ?? asset.id}" (${track?.codec ?? 'no video track'}); preview frames unavailable`,
          )
          input.dispose()
          return null
        }
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
    const keep = new Set(
      [...state.frames.keys()]
        .sort((a, b) => Math.abs(a - centerKey) - Math.abs(b - centerKey))
        .slice(0, 60),
    )
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
