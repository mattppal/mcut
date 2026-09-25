import type { ContentView } from '@mcut/timeline'

const SHUTTER_SAMPLES = 8

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

export function sampleViews(viewAt: (timeMs: number) => ContentView, timeMs: number, shutterMs: number): ContentView[] {
  if (!(shutterMs > 0)) return [viewAt(timeMs)]
  const start = timeMs - shutterMs / 2
  return Array.from({ length: SHUTTER_SAMPLES }, (_, i) => viewAt(start + shutterMs * ((i + 0.5) / SHUTTER_SAMPLES)))
}

export const runningAverageAlpha = (sampleIndex: number): number => 1 / (sampleIndex + 1)

export function applyView(base: SourceRect, view: ContentView): SourceRect {
  const sw = base.sw / view.scale
  const sh = base.sh / view.scale
  return { sx: base.sx + (base.sw - sw) * view.focus.x, sy: base.sy + (base.sh - sh) * view.focus.y, sw, sh }
}
