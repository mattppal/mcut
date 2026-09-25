import { z } from 'zod'
import { animationPresetOptionsSchema, animationPresetSchema, expandAnimationPreset, MOTION_BLUR_PRESETS } from '../animation-presets'
import { CommandError } from '../errors'
import type { ElementId } from '../id'
import {
  animatableProperties,
  animatablePropertySchema,
  easingSchema,
  elementSupportsProperty,
  upsertKeyframe,
  type AnimatableProperty,
  type Keyframe,
} from '../keyframes'
import { elementIdSchema, type Project, type TimelineElement } from '../model'
import { expandZoomPreset, zoomPresetSchema } from '../zoom-presets'
import { defineCommand, mustLocate, replaceTrack } from './shared'
import { isVisualElement } from './visual'

function mustSupportProperty(element: TimelineElement, property: AnimatableProperty): void {
  if (!elementSupportsProperty(element, property)) {
    throw new CommandError(
      'invalid-payload',
      `"${element.type}" elements have no animatable "${property}" ` + `(supported: ${animatableProperties(element).join(', ') || 'none'})`,
    )
  }
}

function withKeyframes(project: Project, elementId: ElementId, property: AnimatableProperty, update: (track: Keyframe[]) => Keyframe[]): Project {
  const { track, element } = mustLocate(project, elementId)
  mustSupportProperty(element, property)
  const keyframes = { ...(('keyframes' in element ? element.keyframes : undefined) ?? {}) }
  const nextTrack = update(keyframes[property] ?? [])
  if (nextTrack.length === 0) delete keyframes[property]
  else keyframes[property] = nextTrack
  const nextElement: TimelineElement = { ...element }
  if (Object.keys(keyframes).length === 0) delete nextElement.keyframes
  else nextElement.keyframes = keyframes
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
  }))
}

export const setKeyframe = defineCommand({
  type: 'setKeyframe',
  description:
    'Add or update a keyframe on a fixed-effect property (position.x/y, scale.x/y, ' +
    'rotation, opacity, blur, volume). The first keyframe arms the property (stopwatch on): ' +
    'an armed property is driven entirely by its keyframes. `timeMs` is element-local ' +
    '(0 = clip start). `easing` shapes the curve TOWARD the next keyframe.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
    value: z.number(),
    easing: easingSchema.optional(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) =>
      upsertKeyframe(track, {
        timeMs: payload.timeMs,
        value: payload.value,
        ...(payload.easing !== undefined ? { easing: payload.easing } : {}),
      }),
    ),
})

export const removeKeyframe = defineCommand({
  type: 'removeKeyframe',
  description: 'Remove the keyframe at an exact element-local time. Removing the last one disarms the property.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      if (!track.some((k) => k.timeMs === payload.timeMs)) {
        throw new CommandError('unknown-keyframe', `no "${payload.property}" keyframe at ${payload.timeMs}ms`)
      }
      return track.filter((k) => k.timeMs !== payload.timeMs)
    }),
})

export const moveKeyframe = defineCommand({
  type: 'moveKeyframe',
  description: 'Retime a keyframe (drag a diamond), preserving its value and easing.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    fromTimeMs: z.number().int().nonnegative(),
    toTimeMs: z.number().int().nonnegative(),
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      const keyframe = track.find((k) => k.timeMs === payload.fromTimeMs)
      if (!keyframe) {
        throw new CommandError('unknown-keyframe', `no "${payload.property}" keyframe at ${payload.fromTimeMs}ms`)
      }
      if (payload.toTimeMs !== payload.fromTimeMs && track.some((k) => k.timeMs === payload.toTimeMs)) {
        throw new CommandError('duplicate-keyframe', `a "${payload.property}" keyframe already exists at ${payload.toTimeMs}ms`)
      }
      return upsertKeyframe(
        track.filter((k) => k.timeMs !== payload.fromTimeMs),
        { ...keyframe, timeMs: payload.toTimeMs },
      )
    }),
})

export const setKeyframeEasing = defineCommand({
  type: 'setKeyframeEasing',
  description: 'Set temporal interpolation toward the next keyframe: linear, hold, easeIn, easeOut, ' + 'easeInOut, or { cubicBezier: [x1, y1, x2, y2] }.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema,
    timeMs: z.number().int().nonnegative(),
    easing: easingSchema,
  }),
  reduce: (project, payload) =>
    withKeyframes(project, payload.elementId, payload.property, (track) => {
      const keyframe = track.find((k) => k.timeMs === payload.timeMs)
      if (!keyframe) {
        throw new CommandError('unknown-keyframe', `no "${payload.property}" keyframe at ${payload.timeMs}ms`)
      }
      return track.map((k) => (k === keyframe ? { ...k, easing: payload.easing } : k))
    }),
})

export const clearKeyframes = defineCommand({
  type: 'clearKeyframes',
  description: 'Remove all keyframes for one property (stopwatch off) or for the whole element. ' + 'The static value takes over again.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    property: animatablePropertySchema.optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    if (!('keyframes' in element) || !element.keyframes) return project
    const nextElement: TimelineElement = { ...element }
    if (payload.property) {
      const keyframes = { ...element.keyframes }
      delete keyframes[payload.property]
      if (Object.keys(keyframes).length === 0) delete nextElement.keyframes
      else nextElement.keyframes = keyframes
    } else {
      delete nextElement.keyframes
    }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
    }))
  },
})

export const applyAnimationPreset = defineCommand({
  type: 'applyAnimationPreset',
  description:
    'Apply an animation preset that EXPANDS into editable keyframes, built on ' +
    'pro easing curves (expo/quint settles, soft overshoot, M3 exits). ' +
    'In: fade-in, slide-in, pop-in, scale-in, zoom-in, whip-in, blur-in. ' +
    'Out: fade-out, slide-out, pop-out, zoom-out, whip-out, blur-out. ' +
    'Emphasis (whole clip): ken-burns, punch-zoom, pulse, breathe, float, sway, shake. ' +
    'Fast presets (whip-in/out, punch-zoom) also enable per-element motion blur. ' +
    '`atMs` is element-local and places the preset, clamped to fit the clip: in and emphasis ' +
    'presets start there, out presets end there. Without it, in presets start at the clip start, ' +
    'out presets end at the clip end, and emphasis spans the clip. The MCP server and Studio ' +
    'fill `atMs` from the playhead when the playhead is on the clip. ' +
    'To fade a clip in and out as one undo step, run the live editor action effects.fade-open-close instead of two presets.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    preset: animationPresetSchema,
    options: animationPresetOptionsSchema.optional(),
    atMs: z.number().int().nonnegative().optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    const expanded = expandAnimationPreset(element, payload.preset, payload.options, payload.atMs)
    for (const property of Object.keys(expanded) as AnimatableProperty[]) {
      mustSupportProperty(element, property)
    }
    const nextElement: TimelineElement = { ...element, keyframes: expanded }
    if (MOTION_BLUR_PRESETS.has(payload.preset) && isVisualElement(nextElement) && nextElement.motionBlur === undefined) {
      nextElement.motionBlur = { enabled: true, shutterAngle: 180 }
    }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? nextElement : e)),
    }))
  },
})

export const applyZoomPreset = defineCommand({
  type: 'applyZoomPreset',
  description:
    'Apply a saved zoom (relative keyframe pattern: scale multipliers + ' +
    'position deltas) to an element at an element-local time. Expands into ' +
    'editable keyframes; existing keyframes inside the window are replaced. ' +
    'Override durationMs to retime the move.',
  payloadSchema: z.object({
    elementId: elementIdSchema,
    preset: zoomPresetSchema,
    atMs: z.number().int().nonnegative(),
    durationMs: z.number().int().min(100).optional(),
  }),
  reduce: (project, payload) => {
    const { track, element } = mustLocate(project, payload.elementId)
    for (const property of Object.keys(payload.preset.tracks) as AnimatableProperty[]) {
      mustSupportProperty(element, property)
    }
    const keyframes = expandZoomPreset(element, payload.preset, payload.atMs, payload.durationMs)
    const next: TimelineElement = { ...element, keyframes }
    return replaceTrack(project, track.id, (t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === element.id ? next : e)),
    }))
  },
})
