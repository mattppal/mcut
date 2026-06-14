import { z } from 'zod'
import {
  easingSchema,
  getAnimatedValue,
  getKeyframes,
  upsertKeyframe,
  type Keyframe,
  type KeyframeMap,
} from './keyframes'
import type { TimelineElement } from './model'

/**
 * Saved zooms: relative keyframe patterns for the punch-in/punch-out moves a
 * talking-head edit applies constantly. A preset stores NORMALIZED tracks —
 * time as a 0..1 fraction of its duration, scale as a MULTIPLIER of the
 * clip's current scale, position as a DELTA in project px — so one preset
 * applies to any clip at any playhead position, at any duration, and expands
 * into ordinary editable keyframes (the animation-preset philosophy).
 */

export const ZOOMABLE_PROPERTIES = ['position.x', 'position.y', 'scale.x', 'scale.y'] as const
export type ZoomableProperty = (typeof ZOOMABLE_PROPERTIES)[number]

const zoomKeySchema = z.object({
  /** 0..1 fraction of the preset duration. */
  t: z.number().min(0).max(1),
  /** scale.*: multiplier of the current value; position.*: delta in px. */
  value: z.number(),
  easing: easingSchema.optional(),
})

export const zoomPresetSchema = z.object({
  name: z.string().min(1),
  /** Default length; override at apply time. */
  durationMs: z.number().int().min(100).default(600),
  tracks: z.partialRecord(z.enum(ZOOMABLE_PROPERTIES), z.array(zoomKeySchema).min(2)),
})

export type ZoomPreset = z.infer<typeof zoomPresetSchema>

const snap = { cubicBezier: [0.2, 0.9, 0.3, 1] as [number, number, number, number] }
const smooth = 'easeInOut' as const

/** Starter zooms (CapCut-grade defaults; the user library layers on top). */
export const ZOOM_PRESETS: ZoomPreset[] = [
  {
    name: 'Punch in',
    durationMs: 350,
    tracks: {
      'scale.x': [
        { t: 0, value: 1, easing: snap },
        { t: 1, value: 1.25 },
      ],
      'scale.y': [
        { t: 0, value: 1, easing: snap },
        { t: 1, value: 1.25 },
      ],
    },
  },
  {
    name: 'Punch out',
    durationMs: 350,
    tracks: {
      'scale.x': [
        { t: 0, value: 1.25, easing: snap },
        { t: 1, value: 1 },
      ],
      'scale.y': [
        { t: 0, value: 1.25, easing: snap },
        { t: 1, value: 1 },
      ],
    },
  },
  {
    name: 'Slow push',
    durationMs: 4000,
    tracks: {
      'scale.x': [
        { t: 0, value: 1, easing: 'linear' },
        { t: 1, value: 1.08 },
      ],
      'scale.y': [
        { t: 0, value: 1, easing: 'linear' },
        { t: 1, value: 1.08 },
      ],
    },
  },
  {
    name: 'Zoom hold return',
    durationMs: 1600,
    tracks: {
      'scale.x': [
        { t: 0, value: 1, easing: snap },
        { t: 0.22, value: 1.35, easing: 'hold' },
        { t: 0.78, value: 1.35, easing: smooth },
        { t: 1, value: 1 },
      ],
      'scale.y': [
        { t: 0, value: 1, easing: snap },
        { t: 0.22, value: 1.35, easing: 'hold' },
        { t: 0.78, value: 1.35, easing: smooth },
        { t: 1, value: 1 },
      ],
    },
  },
]

/**
 * Expand a zoom preset into ABSOLUTE keyframes on `element` starting at
 * element-local `atLocalMs`: relative values are resolved against the clip's
 * animated value at that instant; existing keyframes inside the applied
 * window are replaced (predictable when chaining punch-ins). Returns the new
 * keyframe map for the element.
 */
export function expandZoomPreset(
  element: TimelineElement,
  preset: ZoomPreset,
  atLocalMs: number,
  durationMs?: number,
): KeyframeMap {
  const length = Math.max(100, Math.round(durationMs ?? preset.durationMs))
  const existing: KeyframeMap = 'keyframes' in element ? { ...(element.keyframes ?? {}) } : {}

  for (const [property, keys] of Object.entries(preset.tracks) as Array<
    [ZoomableProperty, ZoomPreset['tracks'][ZoomableProperty]]
  >) {
    if (!keys || keys.length === 0) continue
    const base = getAnimatedValue(element, property, element.startMs + atLocalMs)
    if (Number.isNaN(base)) continue
    const isScale = property.startsWith('scale')

    const windowStart = atLocalMs
    const windowEnd = atLocalMs + length
    let track: Keyframe[] = (existing[property] ?? []).filter(
      (k) => k.timeMs < windowStart || k.timeMs > windowEnd,
    )
    for (const key of keys) {
      track = upsertKeyframe(track, {
        timeMs: Math.round(atLocalMs + key.t * length),
        value: isScale ? base * key.value : base + key.value,
        ...(key.easing !== undefined ? { easing: key.easing } : {}),
      })
    }
    existing[property] = track
  }
  return existing
}

/**
 * Capture the keyframes between two element-local times as a reusable zoom
 * preset ("save what I just hand-animated"). Values normalize relative to
 * each track's first keyframe; returns null when the range has no zoomable
 * keyframes.
 */
export function captureZoomPreset(
  element: TimelineElement,
  name: string,
  fromLocalMs?: number,
  toLocalMs?: number,
): ZoomPreset | null {
  const all = ZOOMABLE_PROPERTIES.flatMap((p) => getKeyframes(element, p))
  if (all.length === 0) return null
  const from = fromLocalMs ?? Math.min(...all.map((k) => k.timeMs))
  const to = toLocalMs ?? Math.max(...all.map((k) => k.timeMs))
  const span = to - from
  if (span <= 0) return null

  const tracks: ZoomPreset['tracks'] = {}
  for (const property of ZOOMABLE_PROPERTIES) {
    const inRange = getKeyframes(element, property).filter(
      (k) => k.timeMs >= from && k.timeMs <= to,
    )
    if (inRange.length < 2) continue
    const first = inRange[0]!.value
    const isScale = property.startsWith('scale')
    if (isScale && first === 0) continue
    tracks[property] = inRange.map((k) => ({
      t: (k.timeMs - from) / span,
      value: isScale ? k.value / first : k.value - first,
      ...(k.easing !== undefined ? { easing: k.easing } : {}),
    }))
  }
  if (Object.keys(tracks).length === 0) return null
  return { name, durationMs: span, tracks }
}
