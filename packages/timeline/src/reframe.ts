import { z } from 'zod'
import type { MulticamElement, VideoElement } from './model'
import { getMulticamSourceTimeMs } from './multicam'
import { getSourceTimeMs } from './speed'
import { valueAt } from './value-at'
import { anchorOf, type VisibleFraction } from './zoom-regions'

const unit = z.number().min(0).max(1)

const reframeKeySchema = z.object({
  sourceMs: z.number().int().nonnegative(),
  x: unit,
  y: unit,
})

export const reframeTrackSchema = z
  .array(reframeKeySchema)
  .min(1)
  .refine(
    (keys) => keys.every((key, index) => index === 0 || key.sourceMs > valueAt(keys, index - 1).sourceMs),
    'reframe keys must be strictly increasing in sourceMs',
  )

export type ReframeTrack = z.infer<typeof reframeTrackSchema>

interface Point {
  x: number
  y: number
}

const pointOf = ({ x, y }: Point): Point => ({ x, y })

function sampleReframe(track: ReframeTrack, sourceMs: number): Point {
  const next = track.findIndex((key) => key.sourceMs > sourceMs)
  if (next === 0) return pointOf(valueAt(track, 0))
  if (next === -1) return pointOf(valueAt(track, track.length - 1))
  const from = valueAt(track, next - 1)
  const to = valueAt(track, next)
  const progress = (sourceMs - from.sourceMs) / (to.sourceMs - from.sourceMs)
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
}

export function getReframeCenter(element: VideoElement | MulticamElement, sourceKey: string | undefined, timelineMs: number): Point | null {
  if (element.type === 'video') {
    return element.reframe ? sampleReframe(element.reframe, getSourceTimeMs(element, timelineMs - element.startMs)) : null
  }
  const source = element.sources.find((s) => s.key === sourceKey)
  return source?.reframe ? sampleReframe(source.reframe, getMulticamSourceTimeMs(element, source, timelineMs)) : null
}

export function centeredFocus(center: Point, visible: VisibleFraction): Point {
  return { x: anchorOf(center.x, visible.x), y: anchorOf(center.y, visible.y) }
}
