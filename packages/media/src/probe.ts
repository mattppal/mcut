import { ALL_FORMATS, BlobSource, Input, UrlSource } from 'mediabunny'
import { createAssetId, type AssetRef } from '@mcut/timeline'
import { hashBlob } from './media-store'
import { isMatroskaLike } from './video-capabilities'

export type MediaSourceLike = Blob | string

/** Open a Mediabunny input over a Blob/File or a (blob:/http:) URL. */
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

interface NativeMediaMetadata {
  durationMs: number
  width?: number
  height?: number
  audioTracks?: number
}

function finiteDurationMs(duration: number): number | null {
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null
}

function loadNativeMetadata(
  tag: 'video' | 'audio',
  src: string,
): Promise<NativeMediaMetadata | null> {
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
      const audioTracks = (media as HTMLMediaElement & { audioTracks?: { length: number } })
        .audioTracks?.length
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

/**
 * Browser-native metadata fallback for files the browser can play but
 * Mediabunny cannot parse, e.g. MP4s with an extra unsupported first stream.
 */
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
        // Native media metadata APIs don't reliably expose audio track
        // presence in every browser; for video assets this only affects
        // metadata, because preview audio comes from the same <video>.
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

/** Resolve true once a throwaway `<video>` decodes the file's first frame. */
function canDecodeNatively(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
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
    // loadeddata (not loadedmetadata): proves the demuxer AND the video
    // decoder both handle the file, not just that the container parses.
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

/** Whether a video can use native `<video>` preview instead of decoded frames. */
export async function hasNativeVideoPreview(file: File, mimeType?: string): Promise<boolean> {
  if (isMatroskaLike({ name: file.name, mimeType: mimeType || file.type })) return false
  if (typeof document === 'undefined') return true
  const type = mimeType || file.type
  if (!type) return true
  if (document.createElement('video').canPlayType(type) !== '') return true
  // canPlayType under-reports: Chrome answers "" for QuickTime containers it
  // demuxes and decodes fine (.mov screen recordings, iPhone footage). Probe
  // by actually decoding a frame before banishing the asset to the decoded
  // path, which costs smooth preview and (without a pooled element) audio.
  return canDecodeNatively(file)
}

/** Read duration, dimensions, and track layout of an audio/video file. */
export async function probeMedia(src: MediaSourceLike): Promise<MediaProbe> {
  const input = inputFor(src)
  try {
    const [durationSeconds, video, audio, mimeType] = await Promise.all([
      input.computeDuration(),
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
    throw error
  } finally {
    input.dispose()
  }
}

/** Read intrinsic dimensions of an image URL (browser only). */
export function probeImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(`failed to load image: ${src}`))
    image.src = src
  })
}

/**
 * Turn a dropped/picked file into a probed {@link AssetRef} ready for the
 * `addAsset` command. Creates an object URL for `src` — callers own its
 * lifetime (revoke when the asset is removed). `hash` (SHA-256) is the
 * asset's stable identity for persistence/relink; very large files skip it.
 */
export async function createAssetFromFile(file: File): Promise<AssetRef> {
  const src = URL.createObjectURL(file)
  const hash = await hashBlob(file).catch(() => null)
  const base = {
    id: createAssetId(),
    src,
    ...(hash ? { hash } : {}),
    name: file.name,
    mimeType: file.type || undefined,
  }
  try {
    if (file.type.startsWith('image/')) {
      const { width, height } = await probeImage(src)
      return { ...base, kind: 'image', width, height }
    }
    const probe = await probeMedia(file)
    if (probe.hasVideo) {
      return {
        ...base,
        kind: 'video',
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        nativePreview: await hasNativeVideoPreview(file, probe.mimeType),
      }
    }
    if (probe.hasAudio) {
      return { ...base, kind: 'audio', durationMs: probe.durationMs }
    }
    throw new Error(`"${file.name}" has no playable audio or video tracks`)
  } catch (error) {
    URL.revokeObjectURL(src)
    throw error
  }
}
