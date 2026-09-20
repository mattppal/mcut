import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, UrlSource } from 'mediabunny'
import { createAssetId, type AssetRef } from '@mcut/timeline'
import { hashBlob } from './media-store'
import { isMatroskaLike } from './video-capabilities'

export type MediaSourceLike = Blob | string

export function inputFor(src: MediaSourceLike): Input {
  return new Input({
    formats: ALL_FORMATS,
    source: typeof src === 'string' ? new UrlSource(src) : new BlobSource(src),
  })
}

export interface MediaProbe {
  durationMs: number
  hasVideo: boolean
  hasAudio: boolean
  width?: number
  height?: number
  mimeType?: string
}

export type MediaOrigin = { kind: 'blob'; blob: Blob; name: string }

export type MediaProberId = 'mediabunny'

export interface MediaProber {
  id: MediaProberId
  probe(origin: MediaOrigin, signal?: AbortSignal): Promise<MediaProbe>
}

export type MediaProbeErrorCode = 'unreadable' | 'no-tracks' | 'no-duration'

export class MediaProbeError extends Error {
  readonly code: MediaProbeErrorCode

  constructor(code: MediaProbeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MediaProbeError'
    this.code = code
  }
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface NativeMediaMetadata {
  durationMs: number
  width?: number
  height?: number
  audioTracks?: number
}

function finiteDurationMs(duration: number): number | null {
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null
}

function trackListLength(trackList: unknown): number | undefined {
  if (typeof trackList !== 'object' || trackList === null || !('length' in trackList)) return undefined
  return typeof trackList.length === 'number' ? trackList.length : undefined
}

function loadNativeMetadata(tag: 'video' | 'audio', src: string): Promise<NativeMediaMetadata | null> {
  return new Promise((resolve) => {
    const media = document.createElement(tag)
    let settled = false
    const settle = (metadata: NativeMediaMetadata | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      media.removeAttribute('src')
      media.load()
      resolve(metadata)
    }
    const timer = setTimeout(() => settle(null), 15_000)
    media.preload = 'metadata'
    media.muted = true
    media.onloadedmetadata = () => {
      const durationMs = finiteDurationMs(media.duration)
      if (durationMs === null) return settle(null)
      const video = media instanceof HTMLVideoElement ? media : null
      const width = video?.videoWidth ?? 0
      const height = video?.videoHeight ?? 0
      const audioTracks = 'audioTracks' in media ? trackListLength(media.audioTracks) : undefined
      settle({
        durationMs,
        ...(width > 0 && height > 0 ? { width, height } : {}),
        ...(audioTracks !== undefined ? { audioTracks } : {}),
      })
    }
    media.onerror = () => settle(null)
    media.src = src
  })
}

async function probeNativeMedia(src: MediaSourceLike): Promise<MediaProbe | null> {
  if (typeof document === 'undefined') return null
  const mimeType = typeof src === 'string' ? undefined : src.type || undefined
  const url = typeof src === 'string' ? src : URL.createObjectURL(src)
  try {
    const video = await loadNativeMetadata('video', url)
    if (video?.width && video.height) {
      return {
        durationMs: video.durationMs,
        hasVideo: true,
        // audioTracks is absent in most engines per https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/audioTracks#browser_compatibility
        hasAudio: video.audioTracks === undefined ? true : video.audioTracks > 0,
        width: video.width,
        height: video.height,
        ...(mimeType ? { mimeType } : {}),
      }
    }
    const audio = await loadNativeMetadata('audio', url)
    if (audio) {
      return {
        durationMs: audio.durationMs,
        hasVideo: false,
        hasAudio: true,
        ...(mimeType ? { mimeType } : {}),
      }
    }
    return null
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url)
  }
}

function canDecodeNatively(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const settle = (result: boolean) => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => settle(false), 5000)
    video.preload = 'auto'
    video.muted = true
    // loadeddata fires once the first frame has decoded, see https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadeddata_event
    video.onloadeddata = () => {
      clearTimeout(timer)
      settle(video.videoWidth > 0)
    }
    video.onerror = () => {
      clearTimeout(timer)
      settle(false)
    }
    video.src = url
  })
}

async function hasNativeVideoPreview(origin: MediaOrigin, mimeType?: string): Promise<boolean> {
  const { blob, name } = origin
  if (isMatroskaLike({ name, mimeType: mimeType || blob.type })) return false
  if (typeof document === 'undefined') return true
  const type = mimeType || blob.type
  if (!type) return true
  if (document.createElement('video').canPlayType(type) !== '') return true
  return canDecodeNatively(blob)
}

async function probeDurationSeconds(input: Input): Promise<number> {
  const tracks = await input.getTracks()
  const firstPackets = await Promise.all(tracks.map((track) => new EncodedPacketSink(track).getFirstPacket({ metadataOnly: true })))
  const computed = await input.computeDuration(tracks.filter((_, index) => firstPackets[index] !== null))
  if (computed > 0) return computed
  return (await input.getDurationFromMetadata(tracks)) ?? 0
}

export async function probeMedia(src: MediaSourceLike): Promise<MediaProbe> {
  const input = inputFor(src)
  try {
    const [durationSeconds, video, audio, mimeType] = await Promise.all([
      probeDurationSeconds(input),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      input.getMimeType().catch(() => undefined),
    ])
    return {
      durationMs: Math.round(durationSeconds * 1000),
      hasVideo: video !== null,
      hasAudio: audio !== null,
      ...(video ? { width: video.displayWidth, height: video.displayHeight } : {}),
      ...(mimeType ? { mimeType } : {}),
    }
  } catch (error) {
    const nativeProbe = await probeNativeMedia(src)
    if (nativeProbe) return nativeProbe
    throw new MediaProbeError('unreadable', `Cannot read this file as audio or video (${describeCause(error)})`, {
      cause: error,
    })
  } finally {
    input.dispose()
  }
}

export function probeImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(`failed to load image: ${src}`))
    image.src = src
  })
}

export const mediabunnyProber: MediaProber = {
  id: 'mediabunny',
  probe: (origin) => probeMedia(origin.blob),
}

export async function createAsset(origin: MediaOrigin, prober: MediaProber = mediabunnyProber): Promise<AssetRef> {
  const { blob, name } = origin
  const src = URL.createObjectURL(blob)
  const hash = await hashBlob(blob).catch(() => null)
  const base = {
    id: createAssetId(),
    src,
    ...(hash ? { hash } : {}),
    name,
    mimeType: blob.type || undefined,
  }
  try {
    if (blob.type.startsWith('image/')) {
      const { width, height } = await probeImage(src)
      return { ...base, kind: 'image', width, height }
    }
    const probe = await prober.probe(origin)
    if (!probe.hasVideo && !probe.hasAudio) {
      throw new MediaProbeError('no-tracks', `"${name}" has no playable audio or video tracks`)
    }
    if (probe.durationMs <= 0) {
      throw new MediaProbeError('no-duration', `"${name}" declares tracks but no playable media (duration 0 ms)`)
    }
    if (probe.hasVideo) {
      return {
        ...base,
        kind: 'video',
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        nativePreview: await hasNativeVideoPreview(origin, probe.mimeType),
      }
    }
    return { ...base, kind: 'audio', durationMs: probe.durationMs }
  } catch (error) {
    URL.revokeObjectURL(src)
    throw error
  }
}
