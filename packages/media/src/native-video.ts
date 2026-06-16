import type { MediaSourceLike } from './probe'

export interface NativeVideoFrameOptions {
  width: number
  timeMs: number
  fit?: 'contain' | 'cover'
}

export interface NativeVideoFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas
  timestampMs: number
}

export interface NativeVideoFilmstripOptions {
  frameCount: number
  frameWidth: number
  startMs?: number
  endMs?: number
}

export interface NativeVideoFilmstrip {
  canvas: HTMLCanvasElement | OffscreenCanvas
  frameWidth: number
  frameHeight: number
  frameCount: number
  timestampsMs: number[]
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  return new OffscreenCanvas(width, height)
}

function loadVideoMetadata(video: HTMLVideoElement, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error) => {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => settle(new Error('timed out loading video metadata')), 15_000)
    video.preload = 'auto'
    video.muted = true
    video.onloadedmetadata = () => settle()
    video.onerror = () => settle(new Error('failed to load video metadata'))
    video.src = src
  })
}

function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (error?: Error) => {
      clearTimeout(timer)
      video.onseeked = null
      video.onloadeddata = null
      video.onerror = null
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => settle(new Error('timed out seeking video')), 15_000)

    if (Math.abs(video.currentTime - timeSeconds) < 0.001 && video.readyState >= 2) {
      settle()
      return
    }

    const onFrameReady = () => settle()
    video.onseeked = onFrameReady
    video.onloadeddata = onFrameReady
    video.onerror = () => settle(new Error('failed to seek video'))
    video.currentTime = timeSeconds
  })
}

function drawVideoFrame(
  video: HTMLVideoElement,
  width: number,
  fit: 'contain' | 'cover' = 'contain',
): HTMLCanvasElement | OffscreenCanvas | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null

  const sourceAspect = video.videoWidth / video.videoHeight
  const height = Math.max(1, Math.round(width / sourceAspect))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) return null

  if (fit === 'cover') {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const drawWidth = video.videoWidth * scale
    const drawHeight = video.videoHeight * scale
    ctx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  } else {
    ctx.drawImage(video, 0, 0, width, height)
  }

  return canvas
}

function sourceUrl(src: MediaSourceLike): { url: string; revoke: () => void } {
  if (typeof src === 'string') return { url: src, revoke: () => {} }
  const url = URL.createObjectURL(src)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

function cleanupVideo(video: HTMLVideoElement): void {
  video.removeAttribute('src')
  video.load()
}

async function withNativeVideo<T>(
  src: MediaSourceLike,
  callback: (video: HTMLVideoElement) => Promise<T>,
): Promise<T | null> {
  if (typeof document === 'undefined') return null

  const { url, revoke } = sourceUrl(src)
  const video = document.createElement('video')
  try {
    await loadVideoMetadata(video, url)
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return null
    return await callback(video)
  } finally {
    cleanupVideo(video)
    revoke()
  }
}

export async function getNativeVideoFrame(
  src: MediaSourceLike,
  options: NativeVideoFrameOptions,
): Promise<NativeVideoFrame | null> {
  return withNativeVideo(src, async (video) => {
    const maxTimeMs = Number.isFinite(video.duration)
      ? Math.max(0, video.duration * 1000 - 1)
      : options.timeMs
    const timestampMs = Math.min(Math.max(0, options.timeMs), maxTimeMs)
    await seekVideo(video, timestampMs / 1000)
    const canvas = drawVideoFrame(video, options.width, options.fit)
    return canvas ? { canvas, timestampMs } : null
  })
}

export async function getNativeVideoFilmstrip(
  src: MediaSourceLike,
  options: NativeVideoFilmstripOptions,
): Promise<NativeVideoFilmstrip | null> {
  return withNativeVideo(src, async (video) => {
    const durationMs = Number.isFinite(video.duration)
      ? Math.round(video.duration * 1000)
      : (options.endMs ?? 0)
    const startMs = options.startMs ?? 0
    const endMs = options.endMs ?? durationMs
    const spanMs = Math.max(1, endMs - startMs)
    const timestampsMs = Array.from(
      { length: options.frameCount },
      (_, i) => startMs + ((i + 0.5) / options.frameCount) * spanMs,
    )

    let strip: HTMLCanvasElement | OffscreenCanvas | null = null
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
    let frameHeight = 0

    for (let index = 0; index < timestampsMs.length; index++) {
      const timestampMs = timestampsMs[index] ?? startMs
      const maxTimeMs = Number.isFinite(video.duration)
        ? Math.max(0, video.duration * 1000 - 1)
        : timestampMs
      await seekVideo(video, Math.min(Math.max(0, timestampMs), maxTimeMs) / 1000)
      const frame = drawVideoFrame(video, options.frameWidth, 'cover')
      if (!frame) continue

      if (!strip) {
        frameHeight = frame.height
        strip = createCanvas(options.frameWidth * options.frameCount, frameHeight)
        ctx = strip.getContext('2d') as CanvasRenderingContext2D | null
      }
      ctx?.drawImage(frame, index * options.frameWidth, 0)
    }

    if (!strip) return null
    return {
      canvas: strip,
      frameWidth: options.frameWidth,
      frameHeight,
      frameCount: options.frameCount,
      timestampsMs,
    }
  })
}
