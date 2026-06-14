import { CanvasSink } from 'mediabunny'
import { inputFor, type MediaSourceLike } from './probe'

export interface FilmstripOptions {
  /** Number of evenly spaced frames. */
  frameCount: number
  /** Width of each frame in px (height follows aspect). Default 80. */
  frameWidth?: number
  /** Source range to sample. Defaults to the whole file. */
  startMs?: number
  endMs?: number
}

export interface Filmstrip {
  /** All frames drawn side-by-side, `frameCount × frameWidth` wide. */
  canvas: HTMLCanvasElement | OffscreenCanvas
  frameWidth: number
  frameHeight: number
  frameCount: number
  /** Source timestamp of each frame, in ms. */
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

/**
 * Sample evenly spaced poster frames into one horizontal strip — the
 * filmstrip background of timeline video clips. Returns `null` for files
 * without a video track.
 */
export async function getFilmstrip(
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

    let strip: HTMLCanvasElement | OffscreenCanvas | null = null
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
    let frameHeight = 0
    let index = 0
    for await (const wrapped of sink.canvasesAtTimestamps(timestampsMs.map((ms) => ms / 1000))) {
      if (wrapped) {
        if (!strip) {
          frameHeight = wrapped.canvas.height
          strip = createCanvas(frameWidth * frameCount, frameHeight)
          ctx = strip.getContext('2d') as CanvasRenderingContext2D | null
        }
        ctx?.drawImage(wrapped.canvas, index * frameWidth, 0)
      }
      index++
    }
    if (!strip) return null
    return { canvas: strip, frameWidth, frameHeight, frameCount, timestampsMs }
  } finally {
    input.dispose()
  }
}
