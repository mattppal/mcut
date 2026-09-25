import type { LayoutSlot } from '@mcut/timeline'

export interface OverlaySample {
  timeMs: number
  rounded: boolean
  cornerContrast: number
  shadowDelta: number
}

type Rgb = [number, number, number]

const PATCH = 1

function frameAt(file: string, timeMs: number, width: number, height: number): Uint8Array {
  const proc = Bun.spawnSync(['ffmpeg', '-v', 'error', '-ss', (timeMs / 1000).toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-'])
  if (proc.exitCode !== 0 || proc.stdout.length !== width * height * 3) throw new Error(`could not read a ${width}x${height} frame at ${timeMs} ms from ${file}. ${proc.stderr.toString().slice(-300)}`)
  return new Uint8Array(proc.stdout)
}

function patch(frame: Uint8Array, width: number, height: number, cx: number, cy: number): Rgb {
  const sum: Rgb = [0, 0, 0]
  let count = 0
  for (let y = Math.round(cy) - PATCH; y <= Math.round(cy) + PATCH; y++) {
    for (let x = Math.round(cx) - PATCH; x <= Math.round(cx) + PATCH; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const at = (y * width + x) * 3
      sum[0] += frame[at] ?? 0
      sum[1] += frame[at + 1] ?? 0
      sum[2] += frame[at + 2] ?? 0
      count += 1
    }
  }
  return [sum[0] / count, sum[1] / count, sum[2] / count]
}

const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

export function sampleOverlay(file: string, timeMs: number, slot: LayoutSlot, width: number, height: number): OverlaySample {
  const frame = frameAt(file, timeMs, width, height)
  const x0 = slot.rect.x * width
  const y0 = slot.rect.y * height
  const x1 = x0 + slot.rect.w * width
  const radius = slot.cornerRadius > 0 ? slot.cornerRadius * Math.min(slot.rect.w * width, slot.rect.h * height) : 0.06 * Math.min(slot.rect.w * width, slot.rect.h * height)
  const inset = Math.max(2, radius * 0.12)
  const along = radius + 10
  const corners = [
    { corner: patch(frame, width, height, x0 + inset, y0 + inset), above: patch(frame, width, height, x0 + inset, y0 - 6), row: patch(frame, width, height, x0 + along, y0 + inset) },
    { corner: patch(frame, width, height, x1 - inset, y0 + inset), above: patch(frame, width, height, x1 - inset, y0 - 6), row: patch(frame, width, height, x1 - along, y0 + inset) },
  ]
  const contrasts = corners.map(({ corner, above, row }) => distance(corner, row) - distance(corner, above))
  const rows = [0.3, 0.45, 0.6].map((fraction) => y0 + slot.rect.h * height * fraction)
  const near = rows.map((y) => luma(patch(frame, width, height, x0 - 6, y)))
  const far = rows.map((y) => luma(patch(frame, width, height, x0 - 40, y)))
  const shadowDelta = far.reduce((a, b) => a + b, 0) / far.length - near.reduce((a, b) => a + b, 0) / near.length
  const cornerContrast = Math.min(...contrasts)
  return { timeMs, rounded: cornerContrast > 0, cornerContrast, shadowDelta }
}
