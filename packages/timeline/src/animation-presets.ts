import { z } from 'zod'
import { ANIMATABLE_PROPERTIES, getStaticValue, upsertKeyframe, type AnimatableProperty, type Easing, type Keyframe, type KeyframeMap } from './keyframes'
import type { TimelineElement } from './model'

export const animationPresetSchema = z.enum([
  'fade-in',
  'slide-in',
  'pop-in',
  'scale-in',
  'zoom-in',
  'whip-in',
  'blur-in',
  'fade-out',
  'slide-out',
  'pop-out',
  'zoom-out',
  'whip-out',
  'blur-out',
  'ken-burns',
  'punch-zoom',
  'pulse',
  'breathe',
  'float',
  'sway',
  'shake',
])

export type AnimationPreset = z.infer<typeof animationPresetSchema>

export const animationPresetOptionsSchema = z.object({
  durationMs: z.number().int().min(50).optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  intensity: z.number().min(0.1).max(4).optional(),
})

export type AnimationPresetOptions = z.infer<typeof animationPresetOptionsSchema>

export const ANIMATION_PRESET_CATEGORIES: Record<'in' | 'out' | 'combo', AnimationPreset[]> = {
  in: ['fade-in', 'slide-in', 'pop-in', 'scale-in', 'zoom-in', 'whip-in', 'blur-in'],
  out: ['fade-out', 'slide-out', 'pop-out', 'zoom-out', 'whip-out', 'blur-out'],
  combo: ['ken-burns', 'punch-zoom', 'pulse', 'breathe', 'float', 'sway', 'shake'],
}

// Control points from https://easings.net and the Material 3 emphasized accelerate token at https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
export const EASINGS = {
  outExpo: { cubicBezier: [0.16, 1, 0.3, 1] },
  outQuint: { cubicBezier: [0.22, 1, 0.36, 1] },
  outCubic: { cubicBezier: [0.33, 1, 0.68, 1] },
  outBack: { cubicBezier: [0.34, 1.56, 0.64, 1] },
  inCubic: { cubicBezier: [0.32, 0, 0.67, 0] },
  inQuart: { cubicBezier: [0.5, 0, 0.75, 0] },
  inExpo: { cubicBezier: [0.7, 0, 0.84, 0] },
  inBack: { cubicBezier: [0.36, 0, 0.66, -0.56] },
  inOutCubic: { cubicBezier: [0.65, 0, 0.35, 1] },
  inOutSine: { cubicBezier: [0.37, 0, 0.63, 1] },
  emphasizedAccelerate: { cubicBezier: [0.3, 0, 0.8, 0.15] },
} satisfies Record<string, Easing>

export const ANIMATION_PRESET_DEFAULT_DURATION_MS: Record<AnimationPreset, number> = {
  'fade-in': 300,
  'slide-in': 450,
  'pop-in': 350,
  'scale-in': 600,
  'zoom-in': 400,
  'whip-in': 300,
  'blur-in': 450,
  'fade-out': 250,
  'slide-out': 300,
  'pop-out': 280,
  'zoom-out': 300,
  'whip-out': 250,
  'blur-out': 300,
  'ken-burns': 500,
  'punch-zoom': 120,
  pulse: 500,
  breathe: 2000,
  float: 1500,
  sway: 2000,
  shake: 350,
}

export const MOTION_BLUR_PRESETS: ReadonlySet<AnimationPreset> = new Set(['whip-in', 'whip-out', 'punch-zoom'])

const SLIDE_DISTANCE = 120
const WHIP_DISTANCE = 480

interface PresetContext {
  element: TimelineElement
  durationMs: number
  direction: 'up' | 'down' | 'left' | 'right'
  intensity: number
}

function staticValue(element: TimelineElement, property: AnimatableProperty): number {
  const value = getStaticValue(element, property)
  return Number.isNaN(value) ? 0 : value
}

type TrackPatch = Partial<Record<AnimatableProperty, Keyframe[]>>

function offsetFor(ctx: PresetContext, distance: number): { property: AnimatableProperty; offset: number } {
  switch (ctx.direction) {
    case 'up':
      return { property: 'position.y', offset: distance }
    case 'down':
      return { property: 'position.y', offset: -distance }
    case 'left':
      return { property: 'position.x', offset: distance }
    case 'right':
      return { property: 'position.x', offset: -distance }
  }
}

function fadeInTrack(ctx: PresetContext, fraction: number, easing: Easing = EASINGS.outCubic): Keyframe[] {
  return [
    { timeMs: 0, value: 0, easing },
    { timeMs: Math.max(1, Math.round(ctx.durationMs * fraction)), value: staticValue(ctx.element, 'opacity') },
  ]
}

function fadeOutTrack(ctx: PresetContext, fraction: number, easing: Easing = EASINGS.inCubic): Keyframe[] {
  const end = ctx.element.durationMs
  return [
    {
      timeMs: Math.max(0, end - Math.round(ctx.durationMs * fraction)),
      value: staticValue(ctx.element, 'opacity'),
      easing,
    },
    { timeMs: end, value: 0 },
  ]
}

function scaleInTracks(ctx: PresetContext, from: number, easing: Easing): TrackPatch {
  const scaleX = staticValue(ctx.element, 'scale.x')
  const scaleY = staticValue(ctx.element, 'scale.y')
  return {
    'scale.x': [
      { timeMs: 0, value: scaleX * from, easing },
      { timeMs: ctx.durationMs, value: scaleX },
    ],
    'scale.y': [
      { timeMs: 0, value: scaleY * from, easing },
      { timeMs: ctx.durationMs, value: scaleY },
    ],
  }
}

function scaleOutTracks(ctx: PresetContext, to: number, easing: Easing): TrackPatch {
  const end = ctx.element.durationMs
  const start = Math.max(0, end - ctx.durationMs)
  const scaleX = staticValue(ctx.element, 'scale.x')
  const scaleY = staticValue(ctx.element, 'scale.y')
  return {
    'scale.x': [
      { timeMs: start, value: scaleX, easing },
      { timeMs: end, value: scaleX * to },
    ],
    'scale.y': [
      { timeMs: start, value: scaleY, easing },
      { timeMs: end, value: scaleY * to },
    ],
  }
}

function oscillateTrack(ctx: PresetContext, base: number, amplitude: number, easing: Easing, bipolar = false): Keyframe[] {
  const end = ctx.element.durationMs
  const steps = Math.max(2, Math.round(end / Math.max(100, ctx.durationMs)))
  const track: Keyframe[] = []
  for (let i = 0; i <= steps; i++) {
    let value: number
    if (i === 0 || i === steps) value = base
    else if (bipolar) value = base + (i % 2 === 1 ? -amplitude : amplitude)
    else value = i % 2 === 1 ? base + amplitude : base
    track.push({ timeMs: Math.round((i / steps) * end), value, easing })
  }
  return track
}

const generators: Record<AnimationPreset, (ctx: PresetContext) => TrackPatch> = {
  'fade-in': (ctx) => ({ opacity: fadeInTrack(ctx, 1) }),
  'slide-in': (ctx) => {
    const { property, offset } = offsetFor(ctx, SLIDE_DISTANCE * ctx.intensity)
    const base = staticValue(ctx.element, property)
    return {
      [property]: [
        { timeMs: 0, value: base + offset, easing: EASINGS.outExpo },
        { timeMs: ctx.durationMs, value: base },
      ],
      opacity: fadeInTrack(ctx, 0.6),
    }
  },
  'pop-in': (ctx) => ({
    ...scaleInTracks(ctx, 1 - 0.15 * ctx.intensity, EASINGS.outBack),
    opacity: fadeInTrack(ctx, 0.4),
  }),
  'scale-in': (ctx) => ({
    ...scaleInTracks(ctx, 1 + 0.15 * ctx.intensity, EASINGS.outExpo),
    opacity: fadeInTrack(ctx, 0.5),
  }),
  'zoom-in': (ctx) => ({
    ...scaleInTracks(ctx, 1 - 0.08 * ctx.intensity, EASINGS.outQuint),
    opacity: fadeInTrack(ctx, 0.6),
  }),
  'whip-in': (ctx) => {
    const { property, offset } = offsetFor(ctx, WHIP_DISTANCE * ctx.intensity)
    const base = staticValue(ctx.element, property)
    return {
      [property]: [
        { timeMs: 0, value: base + offset, easing: EASINGS.outExpo },
        { timeMs: ctx.durationMs, value: base },
      ],
      opacity: fadeInTrack(ctx, 0.25),
    }
  },
  'blur-in': (ctx) => ({
    blur: [
      { timeMs: 0, value: 16 * ctx.intensity, easing: EASINGS.outQuint },
      { timeMs: ctx.durationMs, value: 0 },
    ],
    opacity: fadeInTrack(ctx, 0.6),
  }),

  'fade-out': (ctx) => ({ opacity: fadeOutTrack(ctx, 1) }),
  'slide-out': (ctx) => {
    const { property, offset } = offsetFor(ctx, SLIDE_DISTANCE * ctx.intensity)
    const base = staticValue(ctx.element, property)
    const end = ctx.element.durationMs
    return {
      [property]: [
        { timeMs: Math.max(0, end - ctx.durationMs), value: base, easing: EASINGS.emphasizedAccelerate },
        { timeMs: end, value: base - offset },
      ],
      opacity: fadeOutTrack(ctx, 0.7),
    }
  },
  'pop-out': (ctx) => {
    const end = ctx.element.durationMs
    const start = Math.max(0, end - ctx.durationMs)
    const apex = Math.min(end - 1, start + Math.round(ctx.durationMs * 0.3))
    const trackFor = (base: number): Keyframe[] => [
      { timeMs: start, value: base, easing: EASINGS.outCubic },
      { timeMs: apex, value: base * (1 + 0.04 * ctx.intensity), easing: EASINGS.inBack },
      { timeMs: end, value: base * (1 - 0.15 * ctx.intensity) },
    ]
    return {
      'scale.x': trackFor(staticValue(ctx.element, 'scale.x')),
      'scale.y': trackFor(staticValue(ctx.element, 'scale.y')),
      opacity: fadeOutTrack(ctx, 0.7),
    }
  },
  'zoom-out': (ctx) => ({
    ...scaleOutTracks(ctx, 1 - 0.08 * ctx.intensity, EASINGS.inCubic),
    opacity: fadeOutTrack(ctx, 1),
  }),
  'whip-out': (ctx) => {
    const { property, offset } = offsetFor(ctx, WHIP_DISTANCE * ctx.intensity)
    const base = staticValue(ctx.element, property)
    const end = ctx.element.durationMs
    return {
      [property]: [
        { timeMs: Math.max(0, end - ctx.durationMs), value: base, easing: EASINGS.inExpo },
        { timeMs: end, value: base - offset },
      ],
      opacity: fadeOutTrack(ctx, 0.25),
    }
  },
  'blur-out': (ctx) => {
    const end = ctx.element.durationMs
    return {
      blur: [
        { timeMs: Math.max(0, end - ctx.durationMs), value: 0, easing: EASINGS.inQuart },
        { timeMs: end, value: 16 * ctx.intensity },
      ],
      opacity: fadeOutTrack(ctx, 1),
    }
  },

  'ken-burns': (ctx) => {
    const end = ctx.element.durationMs
    const scaleX = staticValue(ctx.element, 'scale.x')
    const scaleY = staticValue(ctx.element, 'scale.y')
    const zoom = 1 + 0.1 * ctx.intensity
    const drift = 24 * ctx.intensity
    return {
      'scale.x': [
        { timeMs: 0, value: scaleX, easing: EASINGS.inOutSine },
        { timeMs: end, value: scaleX * zoom },
      ],
      'scale.y': [
        { timeMs: 0, value: scaleY, easing: EASINGS.inOutSine },
        { timeMs: end, value: scaleY * zoom },
      ],
      'position.x': [
        { timeMs: 0, value: staticValue(ctx.element, 'position.x'), easing: EASINGS.inOutSine },
        { timeMs: end, value: staticValue(ctx.element, 'position.x') - drift },
      ],
    }
  },
  'punch-zoom': (ctx) => {
    const punch = 1 + 0.15 * ctx.intensity
    const at = Math.min(ctx.durationMs, ctx.element.durationMs)
    const trackFor = (base: number): Keyframe[] => [
      { timeMs: 0, value: base, easing: EASINGS.outExpo },
      { timeMs: at, value: base * punch },
    ]
    return {
      'scale.x': trackFor(staticValue(ctx.element, 'scale.x')),
      'scale.y': trackFor(staticValue(ctx.element, 'scale.y')),
    }
  },
  pulse: (ctx) => ({
    'scale.x': oscillateTrack(ctx, staticValue(ctx.element, 'scale.x'), staticValue(ctx.element, 'scale.x') * 0.05 * ctx.intensity, EASINGS.inOutCubic),
    'scale.y': oscillateTrack(ctx, staticValue(ctx.element, 'scale.y'), staticValue(ctx.element, 'scale.y') * 0.05 * ctx.intensity, EASINGS.inOutCubic),
  }),
  breathe: (ctx) => ({
    'scale.x': oscillateTrack(ctx, staticValue(ctx.element, 'scale.x'), staticValue(ctx.element, 'scale.x') * 0.02 * ctx.intensity, EASINGS.inOutSine),
    'scale.y': oscillateTrack(ctx, staticValue(ctx.element, 'scale.y'), staticValue(ctx.element, 'scale.y') * 0.02 * ctx.intensity, EASINGS.inOutSine),
  }),
  float: (ctx) => ({
    'position.y': oscillateTrack(ctx, staticValue(ctx.element, 'position.y'), 8 * ctx.intensity, EASINGS.inOutSine, true),
  }),
  sway: (ctx) => ({
    rotation: oscillateTrack(ctx, staticValue(ctx.element, 'rotation'), 1.5 * ctx.intensity, EASINGS.inOutSine, true),
  }),
  shake: (ctx) => {
    const end = Math.min(ctx.element.durationMs, ctx.durationMs)
    const base = staticValue(ctx.element, 'position.x')
    const amplitude = 18 * ctx.intensity
    const track: Keyframe[] = []
    const cycles = 4
    for (let i = 0; i <= cycles; i++) {
      const wave = i === 0 || i === cycles ? 0 : (i % 2 === 0 ? 1 : -1) * (1 - i / cycles)
      track.push({ timeMs: Math.round((i / cycles) * end), value: base + amplitude * wave })
    }
    return { 'position.x': track }
  },
}

const WHOLE_CLIP_PRESETS: ReadonlySet<AnimationPreset> = new Set(['ken-burns', 'pulse', 'breathe', 'float', 'sway'])

function shiftPatch(patch: TrackPatch, deltaMs: number): TrackPatch {
  const shifted: TrackPatch = {}
  for (const property of ANIMATABLE_PROPERTIES) {
    const track = patch[property]
    if (track) shifted[property] = track.map((keyframe) => ({ ...keyframe, timeMs: keyframe.timeMs + deltaMs }))
  }
  return shifted
}

function clampMs(value: number, max: number): number {
  return Math.max(0, Math.min(Math.round(value), max))
}

function placedPatch(ctx: PresetContext, preset: AnimationPreset, atMs: number): TrackPatch {
  const end = ctx.element.durationMs
  if (WHOLE_CLIP_PRESETS.has(preset)) {
    const start = clampMs(atMs, end - ctx.durationMs)
    return shiftPatch(generators[preset]({ ...ctx, element: { ...ctx.element, durationMs: end - start } }), start)
  }
  const patch = generators[preset](ctx)
  const times = Object.values(patch).flatMap((track) => track.map((keyframe) => keyframe.timeMs))
  const first = Math.min(...times)
  const span = Math.max(...times) - first
  const anchor = ANIMATION_PRESET_CATEGORIES.out.includes(preset) ? atMs - span : atMs
  return shiftPatch(patch, clampMs(anchor, end - span) - first)
}

export function expandAnimationPreset(element: TimelineElement, preset: AnimationPreset, options: AnimationPresetOptions = {}, atMs?: number): KeyframeMap {
  const ctx: PresetContext = {
    element,
    durationMs: Math.min(options.durationMs ?? ANIMATION_PRESET_DEFAULT_DURATION_MS[preset], element.durationMs),
    direction: options.direction ?? (preset === 'slide-out' ? 'down' : preset === 'whip-in' || preset === 'whip-out' ? 'left' : 'up'),
    intensity: options.intensity ?? 1,
  }
  const patch = atMs === undefined ? generators[preset](ctx) : placedPatch(ctx, preset, atMs)
  const existing = ('keyframes' in element ? element.keyframes : undefined) ?? {}
  const merged: KeyframeMap = { ...existing }
  for (const [property, additions] of Object.entries(patch) as Array<[AnimatableProperty, Keyframe[]]>) {
    let track = merged[property] ?? []
    for (const keyframe of additions) track = upsertKeyframe(track, keyframe)
    merged[property] = track
  }
  return merged
}
