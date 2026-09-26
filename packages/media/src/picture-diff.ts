export const SIGNATURE_WIDTH = 64
export const SIGNATURE_HEIGHT = 36
const CELL_DELTA = 24

export function lumaSignature(rgba: Uint8ClampedArray): Uint8Array {
  const luma = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < luma.length; i++) {
    const p = i * 4
    luma[i] = ((rgba[p] ?? 0) * 77 + (rgba[p + 1] ?? 0) * 150 + (rgba[p + 2] ?? 0) * 29) >> 8
  }
  return luma
}

export function changedFraction(a: Uint8Array, b: Uint8Array): number {
  let changed = 0
  a.forEach((value, i) => {
    if (Math.abs(value - (b[i] ?? value)) > CELL_DELTA) changed++
  })
  return a.length === 0 ? 0 : changed / a.length
}

export function thresholdFor(sensitivity: number): number {
  return 0.05 + (1 - sensitivity) * 0.5
}

export interface PictureChange {
  timeMs: number
  changed: number
}

export interface PictureSegment {
  startMs: number
  endMs: number
}

export function segmentsBetween(startMs: number, endMs: number, changes: readonly PictureChange[]): PictureSegment[] {
  const edges = [startMs, ...changes.map((c) => c.timeMs).filter((t) => t > startMs && t < endMs), endMs]
  return edges.slice(1).map((end, i) => ({ startMs: edges[i] ?? startMs, endMs: end }))
}
