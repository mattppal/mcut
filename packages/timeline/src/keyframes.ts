import { z } from 'zod'
import type { Effect } from './effects'
import { getElementType } from './element-registry'
import type { TimelineElement } from './model'

/**
 * Keyframes on CapCut/Premiere primitives: per-clip "fixed effect" properties
 * (Motion / Opacity / Volume), armed per property, with temporal
 * interpolation stored on the outgoing keyframe.
 *
 * Design decision: this closed property enum covers FIXED effects only.
 * Anything added later that has its own animatable parameters (effect
 * instances, masks) carries its own keyframe map next to those parameters —
 * keyframes live with the thing they animate — rather than widening this
 * enum with paths like `effects.0.amount`.
 */

/**
 * Premiere fixed-effect naming: Motion (position/scale/rotation), Opacity,
 * Volume — plus `blur`, a uniform gaussian blur in project px that powers
 * blur-in/out reveals. Its static value is always 0; the resolved value
 * composes ON TOP of any static blur in the element's effect stack.
 */
export const animatablePropertySchema = z.enum([
  'position.x',
  'position.y',
  'scale.x',
  'scale.y',
  'rotation',
  'opacity',
  'blur',
  'volume',
  // Text tracking in px (title widen/tighten reveals). Text elements only.
  'letterSpacing',
])

export type AnimatableProperty = z.infer<typeof animatablePropertySchema>

export const ANIMATABLE_PROPERTIES = animatablePropertySchema.options

/**
 * Temporal interpolation toward the NEXT keyframe (Premiere's interpolation
 * menu / CapCut's curve presets). Named easings are cubic-bezier aliases;
 * `hold` is a step.
 */
export const easingSchema = z.union([
  z.enum(['linear', 'hold', 'easeIn', 'easeOut', 'easeInOut']),
  z.object({ cubicBezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
])

export type Easing = z.infer<typeof easingSchema>

export const keyframeSchema = z.object({
  /** Element-local ms (relative to `startMs`): moving a clip moves its animation. */
  timeMs: z.number().int().nonnegative(),
  value: z.number(),
  /** Outgoing interpolation; default linear. */
  easing: easingSchema.optional(),
})

export type Keyframe = z.infer<typeof keyframeSchema>

/** Sorted-by-time, unique-time per property (enforced by reducers). */
export const keyframesSchema = z.partialRecord(animatablePropertySchema, z.array(keyframeSchema))

export type KeyframeMap = z.infer<typeof keyframesSchema>

// ---------------------------------------------------------------------------
// Easing evaluation
// ---------------------------------------------------------------------------

const NAMED_BEZIERS: Record<string, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
}

/** y of a CSS-style cubic-bezier timing curve at progress `x` (both 0–1). */
export function cubicBezierAt(points: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = points
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Solve the parametric t for the given x with Newton + bisection fallback.
  const sampleX = (t: number) =>
    3 * t * (1 - t) * (1 - t) * x1 + 3 * t * t * (1 - t) * x2 + t * t * t
  const sampleY = (t: number) =>
    3 * t * (1 - t) * (1 - t) * y1 + 3 * t * t * (1 - t) * y2 + t * t * t
  let t = x
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - x
    if (Math.abs(error) < 1e-6) return sampleY(t)
    const d =
      3 * (1 - t) * (1 - t) * x1 + 6 * t * (1 - t) * (x2 - x1) + 3 * t * t * (1 - x2)
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

/** Eased progress (0–1) for linear progress `t` (0–1). */
export function evaluateEasing(easing: Easing | undefined, t: number): number {
  if (!easing || easing === 'linear') return t
  if (easing === 'hold') return 0
  if (typeof easing === 'object') return cubicBezierAt(easing.cubicBezier, t)
  return cubicBezierAt(NAMED_BEZIERS[easing]!, t)
}

// ---------------------------------------------------------------------------
// Track interpolation
// ---------------------------------------------------------------------------

/**
 * Value of a keyframe track at element-local `localMs`. Premiere semantics:
 * before the first keyframe → first value; after the last → last value.
 */
export function interpolateTrack(track: readonly Keyframe[], localMs: number): number {
  if (track.length === 0) return NaN
  const first = track[0]!
  if (localMs <= first.timeMs) return first.value
  const last = track[track.length - 1]!
  if (localMs >= last.timeMs) return last.value
  // Binary search for the segment containing localMs.
  let lo = 0
  let hi = track.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (track[mid]!.timeMs <= localMs) lo = mid
    else hi = mid
  }
  const from = track[lo]!
  const to = track[hi]!
  const span = to.timeMs - from.timeMs
  const progress = span <= 0 ? 1 : (localMs - from.timeMs) / span
  const eased = evaluateEasing(from.easing, progress)
  return from.value + (to.value - from.value) * eased
}

// ---------------------------------------------------------------------------
// Property access + element resolution
// ---------------------------------------------------------------------------

/**
 * Which fixed-effect properties exist on this element type — declared by the
 * type's registry entry (unknown strings are filtered defensively).
 */
export function animatableProperties(element: TimelineElement): AnimatableProperty[] {
  const declared = getElementType(element.type)?.keyframeable ?? []
  return declared.filter((p): p is AnimatableProperty =>
    (ANIMATABLE_PROPERTIES as readonly string[]).includes(p),
  )
}

export function elementSupportsProperty(
  element: TimelineElement,
  property: AnimatableProperty,
): boolean {
  return animatableProperties(element).includes(property)
}

/** The static (un-animated) value of a fixed-effect property. */
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
      // Animated blur composes on top of the static effect stack; its
      // resting value is "no extra blur".
      return elementSupportsProperty(element, 'blur') ? 0 : NaN
    case 'volume':
      return 'volume' in element ? element.volume : NaN
    case 'letterSpacing':
      return element.type === 'text' ? (element.style.letterSpacing ?? 0) : NaN
  }
}

export function getKeyframes(
  element: TimelineElement,
  property: AnimatableProperty,
): Keyframe[] {
  return ('keyframes' in element ? element.keyframes?.[property] : undefined) ?? []
}

/** Armed = has a keyframe track (Premiere stopwatch on). */
export function hasKeyframes(element: TimelineElement, property?: AnimatableProperty): boolean {
  const keyframes = 'keyframes' in element ? element.keyframes : undefined
  if (!keyframes) return false
  if (property) return (keyframes[property]?.length ?? 0) > 0
  return Object.values(keyframes).some((track) => (track?.length ?? 0) > 0)
}

/** Is the playhead exactly on a keyframe (drives the diamond's filled state)? */
export function isOnKeyframe(
  element: TimelineElement,
  property: AnimatableProperty,
  timelineMs: number,
  toleranceMs = 1,
): boolean {
  const localMs = timelineMs - element.startMs
  return getKeyframes(element, property).some((k) => Math.abs(k.timeMs - localMs) <= toleranceMs)
}

/**
 * Property value at an absolute timeline time: the keyframe track when armed,
 * the static value otherwise.
 */
export function getAnimatedValue(
  element: TimelineElement,
  property: AnimatableProperty,
  timelineMs: number,
): number {
  const track = getKeyframes(element, property)
  if (track.length === 0) return getStaticValue(element, property)
  return interpolateTrack(track, timelineMs - element.startMs)
}

/**
 * The element with every armed property resolved at `timelineMs` — the single
 * seam through which preview, export, hit-testing, and the selection overlay
 * all see animation. Fast path: returns the SAME reference when the element
 * has no keyframes, so un-animated projects pay nothing.
 */
/** Keep animated scale away from the degenerate 0 while allowing flips. */
function clampScale(value: number): number {
  if (Math.abs(value) >= 0.001) return value
  return value < 0 ? -0.001 : 0.001
}

export function resolveAnimatedElement<E extends TimelineElement>(
  element: E,
  timelineMs: number,
): E {
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

  for (const [property, track] of Object.entries(keyframes) as Array<
    [AnimatableProperty, Keyframe[] | undefined]
  >) {
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
    // Appended (= applied last) so it blurs the element's styled result.
    const visual = resolved as E & { effects?: Effect[] }
    visual.effects = [...(visual.effects ?? []), { type: 'blur', enabled: true, radius: blurRadius }]
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Track editing helpers (used by reducers; pure)
// ---------------------------------------------------------------------------

/** Insert-or-replace a keyframe, keeping the track sorted and unique by time. */
export function upsertKeyframe(track: readonly Keyframe[], keyframe: Keyframe): Keyframe[] {
  const next = track.filter((k) => k.timeMs !== keyframe.timeMs)
  const index = next.findIndex((k) => k.timeMs > keyframe.timeMs)
  if (index === -1) next.push(keyframe)
  else next.splice(index, 0, keyframe)
  return next
}

/**
 * Split a keyframe map at element-local `offsetMs` (the cut point) into the
 * tracks for the left and right halves. Boundary keyframes carry the
 * evaluated value so motion stays continuous across the cut; the easing of a
 * crossed segment is approximated on each side by the segment's own easing.
 */
export function splitKeyframes(
  keyframes: KeyframeMap | undefined,
  offsetMs: number,
): { left: KeyframeMap | undefined; right: KeyframeMap | undefined } {
  if (!keyframes) return { left: undefined, right: undefined }
  const left: KeyframeMap = {}
  const right: KeyframeMap = {}
  for (const [property, track] of Object.entries(keyframes) as Array<
    [AnimatableProperty, Keyframe[] | undefined]
  >) {
    if (!track || track.length === 0) continue
    const boundaryValue = interpolateTrack(track, offsetMs)
    // Easing of the segment the cut lands in: the right boundary keyframe
    // keeps it outgoing so the curve's tail shape is approximated.
    let segmentBefore: Keyframe | undefined
    for (const k of track) {
      if (k.timeMs <= offsetMs) segmentBefore = k
      else break
    }
    const boundaryEasing = segmentBefore?.easing
    const leftTrack = track.filter((k) => k.timeMs < offsetMs)
    const rightTrack = track
      .filter((k) => k.timeMs > offsetMs || k.timeMs === offsetMs)
      .map((k) => ({ ...k, timeMs: k.timeMs - offsetMs }))
    // Continuity: each side gets a boundary keyframe at the cut.
    const leftFinal =
      leftTrack.length > 0 || rightTrack.length > 0
        ? upsertKeyframe(leftTrack, { timeMs: offsetMs, value: boundaryValue })
        : leftTrack
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
