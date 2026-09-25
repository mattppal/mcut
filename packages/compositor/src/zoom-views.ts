import type { ContentView } from '@mcut/timeline'

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

export function applyView(base: SourceRect, view: ContentView): SourceRect {
  const sw = base.sw / view.scale
  const sh = base.sh / view.scale
  return { sx: base.sx + (base.sw - sw) * view.focus.x, sy: base.sy + (base.sh - sh) * view.focus.y, sw, sh }
}
