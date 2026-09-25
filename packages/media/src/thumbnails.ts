import { getNativeVideoFrame } from './native-video'
import { inputFor, type MediaSourceLike } from './probe'
import { sampleCanvas } from './sample-bitmap'

export interface ThumbnailOptions {
  width?: number
  timeMs?: number
}

async function getDecodedThumbnail(src: MediaSourceLike, options: ThumbnailOptions = {}): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  const input = await inputFor(src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const { VideoSampleSink } = await import('mediabunny')
    const sample = await new VideoSampleSink(track).getSample((options.timeMs ?? 0) / 1000)
    return sample ? await sampleCanvas(sample, options.width ?? 160) : null
  } finally {
    input.dispose()
  }
}

async function getNativeThumbnail(src: MediaSourceLike, options: ThumbnailOptions = {}): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  const frame = await getNativeVideoFrame(src, {
    width: options.width ?? 160,
    timeMs: options.timeMs ?? 0,
  })
  return frame?.canvas ?? null
}

function canUseDecodeFallback(src: MediaSourceLike): boolean {
  return typeof src !== 'string' || src.startsWith('blob:')
}

function decodeUnavailable(_error: unknown): null {
  return null
}

export async function getVideoThumbnail(src: MediaSourceLike, options: ThumbnailOptions = {}): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  try {
    const native = await getNativeThumbnail(src, options)
    if (native) return native
  } catch (error) {
    if (!canUseDecodeFallback(src)) return decodeUnavailable(error)
  }
  if (!canUseDecodeFallback(src)) return null
  try {
    return await getDecodedThumbnail(src, options)
  } catch (error) {
    return decodeUnavailable(error)
  }
}

export async function getVideoThumbnailUrl(src: MediaSourceLike, options: ThumbnailOptions = {}): Promise<string | null> {
  const canvas = await getVideoThumbnail(src, options)
  if (!canvas) return null
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
    return URL.createObjectURL(blob)
  }
  return canvas.toDataURL('image/jpeg', 0.7)
}
