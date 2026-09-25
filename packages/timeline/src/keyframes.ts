import { z } from 'zod'
import type { Effect } from './effects'
import { assertNever } from './errors'
import type { TimelineElement } from './model'
import { valueAt } from './value-at'

export const animatablePropertySchema = z.enum(['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity', 'blur', 'volume', 'letterSpacing'])

export type AnimatableProperty = z.infer<typeof animatablePropertySchema>

export const ANIMATABLE_PROPERTIES = animatablePropertySchema.options

const ANIMATABLE_PROPERTY_NAMES: ReadonlySet<string> = new Set(ANIMATABLE_PROPERTIES)

function isAnimatableProperty(value: string): value is AnimatableProperty {
  return ANIMATABLE_PROPERTY_NAMES.has(value)
}

export const easingSchema = z.union([
  z.enum(['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut', 'easeInExpo', 'easeOutExpo', 'easeInOutExpo']),
  z.object({ cubicBezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
])

export type Easing = z.infer<typeof easingSchema>

export const keyframeSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  value: z.number(),
  easing: easingSchema.optional(),
})

export type Keyframe = z.infer<typeof keyframeSchema>

export const keyframesSchema = z.partialRecord(animatablePropertySchema, z.array(keyframeSchema))

export type KeyframeMap = z.infer<typeof keyframesSchema>

type NamedEasing = Extract<Easing, string>

const expoIn = (t: number) => (t <= 0 ? 0 : 2 ** (10 * t - 10))
const expoOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))

const NAMED_EASINGS: Record<NamedEasing, (t: number) => number> = {
  linear: (t) => t,
  hold: () => 0,
  easeIn: (t) => cubicBezierAt([0.42, 0, 1, 1], t),
  easeOut: (t) => cubicBezierAt([0, 0, 0.58, 1], t),
  easeInOut: (t) => cubicBezierAt([0.42, 0, 0.58, 1], t),
  easeInExpo: expoIn,
  easeOutExpo: expoOut,
  easeInOutExpo: (t) => (t < 0.5 ? expoIn(2 * t) / 2 : (1 + expoOut(2 * t - 1)) / 2),
}

export function cubicBezierAt(points: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = points
  if (x <= 0) return 0
  if (x >= 1) return 1
  const sampleX = (t: number) => 3 * t * (1 - t) * (1 - t) * x1 + 3 * t * t * (1 - t) * x2 + t * t * t
  const sampleY = (t: number) => 3 * t * (1 - t) * (1 - t) * y1 + 3 * t * t * (1 - t) * y2 + t * t * t
  let t = x
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - x
    if (Math.abs(error) < 1e-6) return sampleY(t)
    const d = 3 * (1 - t) * (1 - t) * x1 + 6 * t * (1 - t) * (x2 - x1) + 3 * t * t * (1 - x2)
    if (Math.abs(d) < 1e-6) break
    t -= error / d
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 32; i++) {
    const current = sampleX(t)
    if (Math.abs(current - x) < 1e-6) break
    if (current < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return sampleY(t)
}

export function evaluateEasing(easing: Easing | undefined, t: number): number {
  if (easing === undefined) return t
  if (typeof easing === 'object') return cubicBezierAt(easing.cubicBezier, t)
  return NAMED_EASINGS[easing](t)
}

export function interpolateTrack(track: readonly Keyframe[], localMs: number): number {
  const first = track[0]
  if (first === undefined) return NaN
  if (localMs <= first.timeMs) return first.value
  const last = valueAt(track, track.length - 1)
  if (localMs >= last.timeMs) return last.value
  let lo = 0
  let hi = track.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (valueAt(track, mid).timeMs <= localMs) lo = mid
    else hi = mid
  }
  const from = valueAt(track, lo)
  const to = valueAt(track, hi)
  const span = to.timeMs - from.timeMs
  const progress = span <= 0 ? 1 : (localMs - from.timeMs) / span
  const eased = evaluateEasing(from.easing, progress)
  return from.value + (to.value - from.value) * eased
}

const MOTION_PROPERTIES: readonly AnimatableProperty[] = ['position.x', 'position.y', 'scale.x', 'scale.y', 'rotation', 'opacity', 'blur']

export function animatableProperties(element: TimelineElement): AnimatableProperty[] {
  switch (element.type) {
    case 'video':
    case 'multicam':
      return [...MOTION_PROPERTIES, 'volume']
    case 'audio':
      return ['volume']
    case 'image':
      return [...MOTION_PROPERTIES]
    case 'text':
      return [...MOTION_PROPERTIES, 'letterSpacing']
    case 'caption':
      return []
    default:
      return assertNever(element)
  }
}

export function elementSupportsProperty(element: TimelineElement, property: AnimatableProperty): boolean {
  return animatableProperties(element).includes(property)
}

export function getStaticValue(element: TimelineElement, property: AnimatableProperty): number {
  switch (property) {
    case 'position.x':
      return 'transform' in element ? element.transform.x : NaN
    case 'position.y':
      return 'transform' in element ? element.transform.y : NaN
    case 'scale.x':
      return 'transform' in element ? element.transform.scaleX : NaN
    case 'scale.y':
      return 'transform' in element ? element.transform.scaleY : NaN
    case 'rotation':
      return 'transform' in element ? element.transform.rotation : NaN
    case 'opacity':
      return 'opacity' in element ? element.opacity : NaN
    case 'blur':
      return elementSupportsProperty(element, 'blur') ? 0 : NaN
    case 'volume':
      return 'volume' in element ? element.volume : NaN
    case 'letterSpacing':
      return element.type === 'text' ? (element.style.letterSpacing ?? 0) : NaN
  }
}

export function getKeyframes(element: TimelineElement, property: AnimatableProperty): Keyframe[] {
  return ('keyframes' in element ? element.keyframes?.[property] : undefined) ?? []
}

export function hasKeyframes(element: TimelineElement, property?: AnimatableProperty): boolean {
  const keyframes = 'keyframes' in element ? element.keyframes : undefined
  if (!keyframes) return false
  if (property) return (keyframes[property]?.length ?? 0) > 0
  return Object.values(keyframes).some((track) => (track?.length ?? 0) > 0)
}

export function isOnKeyframe(element: TimelineElement, property: AnimatableProperty, timelineMs: number, toleranceMs = 1): boolean {
  const localMs = timelineMs - element.startMs
  return getKeyframes(element, property).some((k) => Math.abs(k.timeMs - localMs) <= toleranceMs)
}

export function getAnimatedValue(element: TimelineElement, property: AnimatableProperty, timelineMs: number): number {
  const track = getKeyframes(element, property)
  if (track.length === 0) return getStaticValue(element, property)
  return interpolateTrack(track, timelineMs - element.startMs)
}

function clampScale(value: number): number {
  if (Math.abs(value) >= 0.001) return value
  return value < 0 ? -0.001 : 0.001
}

export function resolveAnimatedElement<E extends TimelineElement>(element: E, timelineMs: number): E {
  const keyframes = 'keyframes' in element ? element.keyframes : undefined
  if (!keyframes) return element
  const localMs = timelineMs - element.startMs

  const resolved = { ...element }
  let blurRadius: number | undefined
  let transform = 'transform' in resolved ? resolved.transform : undefined
  const setTransform = (patch: Partial<NonNullable<typeof transform>>) => {
    if (!transform) return
    transform = { ...transform, ...patch }
  }

  for (const property of ANIMATABLE_PROPERTIES) {
    const track = keyframes[property]
    if (!track || track.length === 0) continue
    const value = interpolateTrack(track, localMs)
    switch (property) {
      case 'position.x':
        setTransform({ x: value })
        break
      case 'position.y':
        setTransform({ y: value })
        break
      case 'scale.x':
        setTransform({ scaleX: clampScale(value) })
        break
      case 'scale.y':
        setTransform({ scaleY: clampScale(value) })
        break
      case 'rotation':
        setTransform({ rotation: value })
        break
      case 'opacity':
        if ('opacity' in resolved) resolved.opacity = Math.min(1, Math.max(0, value))
        break
      case 'blur':
        blurRadius = Math.min(200, Math.max(0, value))
        break
      case 'volume':
        if ('volume' in resolved) resolved.volume = Math.min(2, Math.max(0, value))
        break
      case 'letterSpacing':
        if (resolved.type === 'text') {
          resolved.style = { ...resolved.style, letterSpacing: value }
        }
        break
    }
  }
  if (transform && 'transform' in resolved) resolved.transform = transform
  if (blurRadius !== undefined && blurRadius > 0.01 && elementSupportsProperty(resolved, 'blur')) {
    const visual: TimelineElement = resolved
    const effects = 'effects' in visual ? (visual.effects ?? []) : []
    const blur: Effect = { type: 'blur', enabled: true, radius: blurRadius }
    return { ...resolved, effects: [...effects, blur] }
  }
  return resolved
}

export function upsertKeyframe(track: readonly Keyframe[], keyframe: Keyframe): Keyframe[] {
  const next = track.filter((k) => k.timeMs !== keyframe.timeMs)
  const index = next.findIndex((k) => k.timeMs > keyframe.timeMs)
  if (index === -1) next.push(keyframe)
  else next.splice(index, 0, keyframe)
  return next
}

export function splitKeyframes(keyframes: KeyframeMap | undefined, offsetMs: number): { left: KeyframeMap | undefined; right: KeyframeMap | undefined } {
  if (!keyframes) return { left: undefined, right: undefined }
  const left: KeyframeMap = {}
  const right: KeyframeMap = {}
  for (const property of Object.keys(keyframes).filter(isAnimatableProperty)) {
    const track = keyframes[property]
    if (!track || track.length === 0) continue
    const boundaryValue = interpolateTrack(track, offsetMs)
    let segmentBefore: Keyframe | undefined
    for (const k of track) {
      if (k.timeMs <= offsetMs) segmentBefore = k
      else break
    }
    const boundaryEasing = segmentBefore?.easing
    const leftTrack = track.filter((k) => k.timeMs < offsetMs)
    const rightTrack = track.filter((k) => k.timeMs > offsetMs || k.timeMs === offsetMs).map((k) => ({ ...k, timeMs: k.timeMs - offsetMs }))
    const leftFinal = leftTrack.length > 0 || rightTrack.length > 0 ? upsertKeyframe(leftTrack, { timeMs: offsetMs, value: boundaryValue }) : leftTrack
    const rightFinal =
      rightTrack.length > 0 || leftTrack.length > 0
        ? upsertKeyframe(rightTrack, {
            timeMs: 0,
            value: boundaryValue,
            ...(boundaryEasing !== undefined ? { easing: boundaryEasing } : {}),
          })
        : rightTrack
    if (leftFinal.length > 0) left[property] = leftFinal
    if (rightFinal.length > 0) right[property] = rightFinal
  }
  return {
    left: Object.keys(left).length > 0 ? left : undefined,
    right: Object.keys(right).length > 0 ? right : undefined,
  }
}
