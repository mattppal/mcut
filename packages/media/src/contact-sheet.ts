import type { Project } from '@mcut/timeline'
import { resolvePictureTarget, type PictureTargetInput } from './picture-target'
import { inputFor } from './probe'
import { sampleCanvas } from './sample-bitmap'

export interface ContactSheetOptions extends PictureTargetInput {
  timesMs?: readonly number[]
  count?: number
  columns?: number
  thumbWidth?: number
}

export interface ContactSheet {
  blob: Blob
  width: number
  height: number
  columns: number
  elementId: string
  source?: string
  tiles: { timeMs: number }[]
}

const GAP = 4
const LABEL_HEIGHT = 22

function tileTimes(startMs: number, endMs: number, options: ContactSheetOptions): number[] {
  if (options.timesMs !== undefined) {
    const inside = [...new Set(options.timesMs.map(Math.round))].filter((t) => t >= startMs && t < endMs).sort((a, b) => a - b)
    if (inside.length === 0) throw new Error(`None of timesMs falls inside ${startMs} to ${endMs} ms.`)
    return inside
  }
  const count = options.count ?? 12
  return Array.from({ length: count }, (_, i) => Math.round(startMs + ((i + 0.5) / count) * (endMs - startMs)))
}

const label = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export async function renderContactSheet(project: Project, options: ContactSheetOptions = {}): Promise<ContactSheet> {
  const target = resolvePictureTarget(project, options)
  const times = tileTimes(target.startMs, target.endMs, options)
  const thumbWidth = options.thumbWidth ?? 320
  const aspect = (target.asset.width ?? 16) / (target.asset.height ?? 9)
  const thumbHeight = Math.max(1, Math.round(thumbWidth / aspect))
  const columns = Math.min(times.length, options.columns ?? Math.ceil(Math.sqrt(times.length)))
  const rows = Math.ceil(times.length / columns)
  const canvas = new OffscreenCanvas(columns * thumbWidth + (columns + 1) * GAP, rows * thumbHeight + (rows + 1) * GAP)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create a canvas context for the contact sheet.')
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const order = times.map((timeMs, index) => ({ index, sourceMs: target.sourceMsAt(timeMs) })).sort((a, b) => a.sourceMs - b.sourceMs)
  const input = await inputFor(target.asset.src)
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`Asset "${target.asset.id}" has no video track.`)
    const { VideoSampleSink } = await import('mediabunny')
    const sink = new VideoSampleSink(track)
    let next = 0
    for await (const sample of sink.samplesAtTimestamps(order.map((o) => o.sourceMs / 1000))) {
      const slot = order[next++]
      if (!sample || !slot) {
        sample?.close()
        continue
      }
      const thumb = await sampleCanvas(sample, thumbWidth)
      const x = GAP + (slot.index % columns) * (thumbWidth + GAP)
      const y = GAP + Math.floor(slot.index / columns) * (thumbHeight + GAP)
      ctx.drawImage(thumb, x, y, thumbWidth, thumbHeight)
    }
  } finally {
    input.dispose()
  }

  ctx.font = 'bold 15px sans-serif'
  ctx.textBaseline = 'middle'
  times.forEach((timeMs, index) => {
    const x = GAP + (index % columns) * (thumbWidth + GAP)
    const y = GAP + Math.floor(index / columns) * (thumbHeight + GAP) + thumbHeight - LABEL_HEIGHT
    const text = label(timeMs)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(x, y, ctx.measureText(text).width + 12, LABEL_HEIGHT)
    ctx.fillStyle = '#fff'
    ctx.fillText(text, x + 6, y + LABEL_HEIGHT / 2)
  })

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    columns,
    elementId: target.elementId,
    ...(target.source !== undefined ? { source: target.source } : {}),
    tiles: times.map((timeMs) => ({ timeMs })),
  }
}
