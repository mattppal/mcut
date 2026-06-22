import { CanvasSink } from 'mediabunny'
import { getNativeVideoFrame } from './native-video'
import { inputFor, type MediaSourceLike } from './probe'

export interface ThumbnailOptions {
  /** Thumbnail width in px (height follows aspect ratio). Default 160. */
  width?: number
  /** Source time to sample. Default 0. */
  timeMs?: number
}

async function getCanvasSinkThumbnail(
  src: MediaSourceLike,
  options: ThumbnailOptions = {},
): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  const input = inputFor(src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const sink = new CanvasSink(track, { width: options.width ?? 160 })
    const wrapped = await sink.getCanvas((options.timeMs ?? 0) / 1000)
    return wrapped?.canvas ?? null
  } finally {
    input.dispose()
  }
}

async function getNativeThumbnail(
  src: MediaSourceLike,
  options: ThumbnailOptions = {},
): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  const frame = await getNativeVideoFrame(src, {
    width: options.width ?? 160,
    timeMs: options.timeMs ?? 0,
  })
  return frame?.canvas ?? null
}

function canUseCanvasSinkFallback(src: MediaSourceLike): boolean {
  return typeof src !== 'string' || src.startsWith('blob:')
}

/** Extract a single poster frame from a video. Returns `null` for audio-only files. */
export async function getVideoThumbnail(
  src: MediaSourceLike,
  options: ThumbnailOptions = {},
): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  try {
    const native = await getNativeThumbnail(src, options)
    if (native) return native
  } catch {
    // Fall through: browser-native capture is unavailable or cannot decode this source.
  }
  if (!canUseCanvasSinkFallback(src)) return null
  try {
    return await getCanvasSinkThumbnail(src, options)
  } catch {
    return null
  }
}

/** A poster frame as a data URL (handy for `<img>` in media bins). */
export async function getVideoThumbnailUrl(
  src: MediaSourceLike,
  options: ThumbnailOptions = {},
): Promise<string | null> {
  const canvas = await getVideoThumbnail(src, options)
  if (!canvas) return null
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
    return URL.createObjectURL(blob)
  }
  return canvas.toDataURL('image/jpeg', 0.7)
}
