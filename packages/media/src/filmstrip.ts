import { CanvasSink } from 'mediabunny'
import { createCanvasSurface, getNativeVideoFilmstrip, type CanvasSurface } from './native-video'
import { inputFor, type MediaSourceLike } from './probe'

export interface FilmstripOptions {
  frameCount: number
  frameWidth?: number
  startMs?: number
  endMs?: number
}

export interface Filmstrip {
  canvas: HTMLCanvasElement | OffscreenCanvas
  frameWidth: number
  frameHeight: number
  frameCount: number
  timestampsMs: number[]
}

async function getCanvasSinkFilmstrip(
  src: MediaSourceLike,
  options: FilmstripOptions,
): Promise<Filmstrip | null> {
  const frameWidth = options.frameWidth ?? 80
  const frameCount = Math.max(1, Math.round(options.frameCount))
  const input = inputFor(src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const durationMs = options.endMs ?? (await input.computeDuration()) * 1000
    const startMs = options.startMs ?? 0
    const spanMs = Math.max(1, durationMs - startMs)

    const timestampsMs = Array.from(
      { length: frameCount },
      (_, i) => startMs + ((i + 0.5) / frameCount) * spanMs,
    )
    const sink = new CanvasSink(track, { width: frameWidth, fit: 'cover' })

    let strip: CanvasSurface | null = null
    let frameHeight = 0
    let index = 0
    for await (const wrapped of sink.canvasesAtTimestamps(timestampsMs.map((ms) => ms / 1000))) {
      if (wrapped) {
        if (!strip) {
          frameHeight = wrapped.canvas.height
          strip = createCanvasSurface(frameWidth * frameCount, frameHeight)
        }
        strip.ctx?.drawImage(wrapped.canvas, index * frameWidth, 0)
      }
      index++
    }
    if (!strip) return null
    return { canvas: strip.canvas, frameWidth, frameHeight, frameCount, timestampsMs }
  } finally {
    input.dispose()
  }
}

async function getNativeFilmstrip(
  src: MediaSourceLike,
  frameWidth: number,
  frameCount: number,
  options: FilmstripOptions,
): Promise<Filmstrip | null> {
  return getNativeVideoFilmstrip(src, {
    frameWidth,
    frameCount,
    startMs: options.startMs,
    endMs: options.endMs,
  })
}

function canUseCanvasSinkFallback(src: MediaSourceLike): boolean {
  return typeof src !== 'string' || src.startsWith('blob:')
}

function decodeUnavailable(_error: unknown): null {
  return null
}

export async function getFilmstrip(
  src: MediaSourceLike,
  options: FilmstripOptions,
): Promise<Filmstrip | null> {
  const frameWidth = options.frameWidth ?? 80
  const frameCount = Math.max(1, Math.round(options.frameCount))

  try {
    const native = await getNativeFilmstrip(src, frameWidth, frameCount, options)
    if (native) return native
  } catch (error) {
    if (!canUseCanvasSinkFallback(src)) return decodeUnavailable(error)
  }
  if (!canUseCanvasSinkFallback(src)) return null
  try {
    return await getCanvasSinkFilmstrip(src, { ...options, frameWidth, frameCount })
  } catch (error) {
    return decodeUnavailable(error)
  }
}
