import { z } from 'zod'
import { CommandError } from './errors'
import { easingSchema, evaluateEasing } from './keyframes'
import type { LayoutSlot } from './layouts'
import type { ImageElement, MulticamElement, Project, TimelineElement, VideoElement } from './model'

const unit = z.number().min(0).max(1)

const focusSchema = z.object({ x: unit, y: unit })

export const zoomRegionSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1).optional(),
  atMs: z.number().int(),
  inMs: z.number().int().min(1),
  holdMs: z.number().int().nonnegative(),
  outMs: z.number().int().min(1),
  focus: focusSchema,
  scale: z.number().min(1).max(8),
  easing: easingSchema,
  motionBlur: unit,
})

export type ZoomRegion = z.infer<typeof zoomRegionSchema>

export const ZOOM_REGION_PRESETS = {
  subtlePunchIn: { scale: 1.15, inMs: 700, holdMs: 1600, outMs: 700 },
  detailZoom: { scale: 1.3, inMs: 600, holdMs: 3000, outMs: 600 },
} as const satisfies Record<string, Pick<ZoomRegion, 'scale' | 'inMs' | 'holdMs' | 'outMs'>>

const presetSchema = z.enum(['subtlePunchIn', 'detailZoom'])

const rectSchema = z.object({ x: unit, y: unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })

const targetShape = {
  focus: focusSchema.describe('Point to zoom into, 0 to 1 across the cropped frame of the clip or slot.').optional(),
  scale: z.number().min(1).max(8).optional(),
  rect: rectSchema
    .describe(
      'Region to zoom toward, 0 to 1 across the cropped frame of the clip or slot. Sets focus to its center and fills it up to the preset scale; pass focus and scale instead for a stronger zoom.',
    )
    .optional(),
}

const noRectWithFocus = (value: { rect?: unknown; focus?: unknown; scale?: unknown }) =>
  value.rect === undefined || (value.focus === undefined && value.scale === undefined)
const rectMessage = 'pass either rect or focus/scale, not both'

export const zoomRegionInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    preset: presetSchema.default('subtlePunchIn').describe('subtlePunchIn is 1.15x, detailZoom is 1.3x. Explicit fields override it.'),
    source: z
      .string()
      .min(1)
      .describe('Multicam only: the source key whose slots zoom, e.g. "screen". Other slots stay put. Omit it to zoom the whole composite.')
      .optional(),
    atMs: z.number().int().nonnegative().describe('Element-local time the zoom-in starts.'),
    inMs: z.number().int().min(1).optional(),
    holdMs: z.number().int().nonnegative().optional(),
    outMs: z.number().int().min(1).optional(),
    ...targetShape,
    easing: easingSchema.default('easeOutExpo'),
    motionBlur: unit.default(0.5).describe('Shutter fraction of a frame while the zoom moves. 0 turns motion blur off.'),
  })
  .refine(noRectWithFocus, rectMessage)

export const zoomRegionPatchSchema = z
  .object({
    atMs: z.number().int().nonnegative().optional(),
    inMs: z.number().int().min(1).optional(),
    holdMs: z.number().int().nonnegative().optional(),
    outMs: z.number().int().min(1).optional(),
    ...targetShape,
    easing: easingSchema.optional(),
    motionBlur: unit.optional(),
  })
  .refine(noRectWithFocus, rectMessage)

type ZoomTarget = z.infer<z.ZodObject<typeof targetShape>>

function resolveTarget(target: ZoomTarget, rectScaleCap: number): Partial<Pick<ZoomRegion, 'focus' | 'scale'>> {
  if (!target.rect) return { ...(target.focus ? { focus: target.focus } : {}), ...(target.scale !== undefined ? { scale: target.scale } : {}) }
  const { x, y, w, h } = target.rect
  return {
    focus: { x: Math.min(1, x + w / 2), y: Math.min(1, y + h / 2) },
    scale: Math.min(rectScaleCap, Math.max(1, 1 / Math.max(w, h))),
  }
}

export function resolveZoomRegion(input: z.output<typeof zoomRegionInputSchema>, id: string): ZoomRegion {
  const preset = ZOOM_REGION_PRESETS[input.preset]
  const target = resolveTarget(input, preset.scale)
  return zoomRegionSchema.parse({
    id,
    ...(input.source !== undefined ? { source: input.source } : {}),
    atMs: input.atMs,
    inMs: input.inMs ?? preset.inMs,
    holdMs: input.holdMs ?? preset.holdMs,
    outMs: input.outMs ?? preset.outMs,
    focus: target.focus ?? { x: 0.5, y: 0.5 },
    scale: target.scale ?? preset.scale,
    easing: input.easing,
    motionBlur: input.motionBlur,
  })
}

export function patchZoomRegion(region: ZoomRegion, patch: z.output<typeof zoomRegionPatchSchema>): ZoomRegion {
  const { atMs, inMs, holdMs, outMs, easing, motionBlur } = patch
  const timing = Object.fromEntries(Object.entries({ atMs, inMs, holdMs, outMs, easing, motionBlur }).filter(([, value]) => value !== undefined))
  return zoomRegionSchema.parse({ ...region, ...timing, ...resolveTarget(patch, region.scale) })
}

export const zoomRegionEndMs = (region: ZoomRegion): number => region.atMs + region.inMs + region.holdMs + region.outMs

export function mustNotOverlap(zooms: readonly ZoomRegion[]): void {
  const sorted = [...zooms].sort((a, b) => a.atMs - b.atMs)
  for (const [index, zoom] of sorted.entries()) {
    const clash = sorted.slice(index + 1).find((other) => other.source === zoom.source && other.atMs < zoomRegionEndMs(zoom))
    if (clash) throw new CommandError('invalid-payload', `zooms "${zoom.id}" and "${clash.id}" overlap on the same target`)
  }
}

type Phase = { kind: 'in' | 'out'; region: ZoomRegion; progress: number } | { kind: 'hold'; region: ZoomRegion }

function phaseAt(zooms: readonly ZoomRegion[] | undefined, source: string | undefined, localMs: number): Phase | null {
  const region = zooms?.find((z) => z.source === source && localMs >= z.atMs && localMs < zoomRegionEndMs(z))
  if (!region) return null
  const intoMs = localMs - region.atMs
  if (intoMs < region.inMs) return { kind: 'in', region, progress: intoMs / region.inMs }
  const outStartMs = region.inMs + region.holdMs
  if (intoMs < outStartMs) return { kind: 'hold', region }
  return { kind: 'out', region, progress: (intoMs - outStartMs) / region.outMs }
}

function amountAt(phase: Phase): number {
  if (phase.kind === 'hold') return 1
  const eased = evaluateEasing(phase.region.easing, phase.progress)
  return phase.kind === 'in' ? eased : 1 - eased
}

export function anchorOf(center: number, visibleAtHold: number): number {
  if (visibleAtHold >= 1) return 0.5
  const start = Math.min(1 - visibleAtHold, Math.max(0, center - visibleAtHold / 2))
  return start / (1 - visibleAtHold)
}

export interface ContentView {
  scale: number
  focus: { x: number; y: number }
}

export interface VisibleFraction {
  x: number
  y: number
}

const FULL_FRAME: VisibleFraction = { x: 1, y: 1 }

const CENTER: ContentView['focus'] = { x: 0.5, y: 0.5 }

function zoomViewAt(
  zooms: readonly ZoomRegion[] | undefined,
  source: string | undefined,
  localMs: number,
  visible: VisibleFraction,
  rest: ContentView['focus'],
): ContentView {
  const phase = phaseAt(zooms, source, localMs)
  if (!phase) return { scale: 1, focus: rest }
  const amount = amountAt(phase)
  const { scale, focus } = phase.region
  const lerp = (from: number, to: number) => from + (to - from) * amount
  return {
    scale: lerp(1, scale),
    focus: {
      x: lerp(rest.x, anchorOf(focus.x, visible.x / scale)),
      y: lerp(rest.y, anchorOf(focus.y, visible.y / scale)),
    },
  }
}

export function getSlotView(
  element: MulticamElement,
  slot: LayoutSlot,
  timelineMs: number,
  visible: VisibleFraction = FULL_FRAME,
  rest: ContentView['focus'] = CENTER,
): ContentView {
  return zoomViewAt(element.zooms, slot.source, timelineMs - element.startMs, visible, rest)
}

export function getClipView(element: ZoomableElement, timelineMs: number): ContentView {
  return zoomViewAt(element.zooms, undefined, timelineMs - element.startMs, FULL_FRAME, CENTER)
}

export function getZoomShutterMs(element: TimelineElement, timelineMs: number, frameMs: number): number {
  if (!isZoomable(element)) return 0
  const localMs = timelineMs - element.startMs
  const sources = new Set((element.zooms ?? []).map((z) => z.source))
  let shutterMs = 0
  for (const source of sources) {
    const phase = phaseAt(element.zooms, source, localMs)
    if (phase && phase.kind !== 'hold') shutterMs = Math.max(shutterMs, frameMs * phase.region.motionBlur)
  }
  return shutterMs
}

export function splitZoomRegions(zooms: readonly ZoomRegion[], offsetMs: number): { left: ZoomRegion[]; right: ZoomRegion[] } {
  return {
    left: zooms.filter((z) => z.atMs < offsetMs),
    right: zooms.filter((z) => zoomRegionEndMs(z) > offsetMs).map((z) => ({ ...z, atMs: z.atMs - offsetMs })),
  }
}

export function renameSplitCopies(zooms: readonly ZoomRegion[], taken: Set<string>): ZoomRegion[] {
  return zooms.map((zoom) => {
    if (zoom.atMs >= 0) return zoom
    let id = `${zoom.id}-r`
    while (taken.has(id)) id += '-r'
    taken.add(id)
    return { ...zoom, id }
  })
}

export const shiftZoomRegions = (zooms: readonly ZoomRegion[], deltaMs: number): ZoomRegion[] => zooms.map((z) => ({ ...z, atMs: z.atMs + deltaMs }))

export type ZoomableElement = VideoElement | ImageElement | MulticamElement

export function isZoomable(element: TimelineElement): element is ZoomableElement {
  return element.type === 'video' || element.type === 'image' || element.type === 'multicam'
}

export interface ZoomRegionRef extends ZoomRegion {
  elementId: string
  startMs: number
  endMs: number
}

export function zoomRegionRefs(element: ZoomableElement): ZoomRegionRef[] {
  const onTimeline = (localMs: number) => element.startMs + Math.min(element.durationMs, Math.max(0, localMs))
  return (element.zooms ?? []).map((region) => ({
    ...region,
    elementId: element.id,
    startMs: onTimeline(region.atMs),
    endMs: onTimeline(zoomRegionEndMs(region)),
  }))
}

export function listZoomRegions(project: Project): ZoomRegionRef[] {
  return project.tracks.flatMap((track) => track.elements.filter(isZoomable).flatMap(zoomRegionRefs))
}
