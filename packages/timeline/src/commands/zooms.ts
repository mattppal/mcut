import { z } from 'zod'
import { assertNever, CommandError } from '../errors'
import { createZoomId } from '../id'
import { elementIdSchema, type Project, type TimelineElement } from '../model'
import {
  isZoomable,
  listZoomRegions,
  mustNotOverlap,
  patchZoomRegion,
  resolveZoomRegion,
  zoomRegionEndMs,
  zoomRegionInputSchema,
  zoomRegionPatchSchema,
  type ZoomableElement,
  type ZoomRegion,
} from '../zoom-regions'
import { defineCommand, mustLocate, replaceTrack } from './shared'

const zoomClockSchema = z
  .enum(['element', 'timeline'])
  .describe(
    'Clock for atMs. "timeline" is project timeline ms, where the playhead sits and get_summary lists zooms. ' +
      '"element" is ms from the element start. Omitted means "element" in the SDK; the MCP server fills in "timeline".',
  )
  .optional()

function mustBeZoomable(element: TimelineElement): ZoomableElement {
  if (!isZoomable(element)) {
    throw new CommandError('invalid-payload', `"${element.type}" elements cannot zoom; use a video, image, or multicam element`)
  }
  return element
}

function withZooms(
  project: Project,
  elementId: string,
  update: (zooms: ZoomRegion[], element: ZoomableElement) => { zooms: ZoomRegion[]; touched: ZoomRegion | null },
  fit: 'inside' | 'overlap' = 'inside',
): Project {
  const { track, element: located } = mustLocate(project, elementIdSchema.parse(elementId))
  const element = mustBeZoomable(located)
  const { zooms, touched } = update([...(element.zooms ?? [])], element)
  if (touched) {
    mustFitWindow(element, touched, fit)
    mustHaveSource(element, touched)
  }
  return replaceTrack(project, track.id, (t) => ({ ...t, elements: t.elements.map((e) => (e.id === element.id ? withSortedZooms(element, zooms) : e)) }))
}

function withSortedZooms(element: ZoomableElement, zooms: readonly ZoomRegion[]): ZoomableElement {
  const sorted = [...zooms].sort((a, b) => a.atMs - b.atMs)
  mustNotOverlap(sorted)
  const next: ZoomableElement = { ...element, zooms: sorted }
  if (sorted.length === 0) delete next.zooms
  return next
}

function mustFitWindow(element: ZoomableElement, zoom: ZoomRegion, fit: 'inside' | 'overlap'): void {
  const endMs = zoomRegionEndMs(zoom)
  if (fit === 'inside' ? zoom.atMs >= 0 && endMs <= element.durationMs : zoom.atMs < element.durationMs && endMs > 0) return
  const at = (localMs: number) => `${localMs}ms (timeline ${element.startMs + localMs}ms)`
  throw new CommandError(
    'out-of-bounds',
    `zoom "${zoom.id}" spans element-local ${at(zoom.atMs)} to ${at(zoomRegionEndMs(zoom))}, outside "${element.id}", which plays timeline ${element.startMs} to ${element.startMs + element.durationMs}ms`,
  )
}

function mustHaveSource(element: ZoomableElement, zoom: ZoomRegion): void {
  if (element.type !== 'multicam') {
    if (zoom.source !== undefined) throw new CommandError('invalid-payload', `source applies only to multicam zooms; "${element.id}" is ${element.type}`)
    return
  }
  if (zoom.source !== undefined && !element.sources.some((s) => s.key === zoom.source)) {
    throw new CommandError('invalid-payload', `multicam "${element.id}" has no source "${zoom.source}"`)
  }
}

function mustFind(zooms: readonly ZoomRegion[], zoomId: string): ZoomRegion {
  const zoom = zooms.find((z) => z.id === zoomId)
  if (!zoom) throw new CommandError('unknown-zoom', `no zoom "${zoomId}"`)
  return zoom
}

function mediaOf(element: TimelineElement): string | null {
  switch (element.type) {
    case 'video':
    case 'image':
      return `${element.type}:${element.assetId}`
    case 'multicam':
      return `multicam:${element.sources.map((s) => `${s.key}=${s.assetId}`).join(',')}`
    case 'audio':
    case 'text':
    case 'caption':
      return null
    default:
      return assertNever(element)
  }
}

function takesZoom(target: ZoomableElement, element: TimelineElement): element is ZoomableElement {
  return mediaOf(element) === mediaOf(target)
}

function addAcrossPieces(project: Project, elementId: string, zoom: ZoomRegion): Project {
  const { track, element: located } = mustLocate(project, elementIdSchema.parse(elementId))
  const target = mustBeZoomable(located)
  mustHaveSource(target, zoom)
  const startMs = zoom.atMs
  const endMs = zoomRegionEndMs(zoom)
  const pieces = track.elements.filter((e) => takesZoom(target, e) && e.startMs < endMs && e.startMs + e.durationMs > startMs)
  const first = pieces.find((e) => e.startMs <= startMs)
  const last = pieces.at(-1)
  if (!first || !last) {
    throw new CommandError('out-of-bounds', `timeline ${startMs}ms is not on a ${target.type} piece on the track of "${target.id}"`)
  }
  if (last.startMs + last.durationMs < endMs) {
    throw new CommandError(
      'out-of-bounds',
      `zoom "${zoom.id}" runs to timeline ${endMs}ms, past the last ${target.type} piece, which ends at ${last.startMs + last.durationMs}ms`,
    )
  }
  const gap = pieces.find((piece, i) => {
    const before = pieces[i - 1]
    return before !== undefined && piece.startMs !== before.startMs + before.durationMs
  })
  if (gap) throw new CommandError('out-of-bounds', `zoom "${zoom.id}" crosses a gap before "${gap.id}"; place one zoom on each side of the gap`)
  const taken = new Set(listZoomRegions(project).map((z) => z.id))
  if (taken.has(zoom.id)) throw new CommandError('invalid-payload', `zoom "${zoom.id}" already exists`)
  const copies = new Map<string, ZoomRegion>()
  for (const [index, piece] of pieces.entries()) {
    let id = zoom.id
    if (index > 0) {
      id = `${zoom.id}-r`
      while (taken.has(id)) id += '-r'
    }
    taken.add(id)
    copies.set(piece.id, { ...zoom, id, atMs: startMs - piece.startMs })
  }
  return replaceTrack(project, track.id, (t) => ({
    ...t,
    elements: t.elements.map((e) => {
      const copy = copies.get(e.id)
      return copy && isZoomable(e) ? withSortedZooms(e, [...(e.zooms ?? []), copy]) : e
    }),
  }))
}

export const addZoomRegion = defineCommand({
  type: 'addZoomRegion',
  description:
    'Add a zoom region to a video, image, or multicam element: zoom in over inMs, hold, zoom out over outMs, with easing and motion blur. ' +
    'Defaults to the subtlePunchIn preset (1.15x, easeOutExpo, motion blur 0.5). ' +
    'With time "timeline", atMs is project timeline ms and the zoom covers that timeline range across every abutting piece of the same media on the track, ' +
    'so a zoom over a cut between two pieces is one call. Each piece after the first gets a copy with "-r" added to the id. ' +
    'On a multicam, source names the angle whose slots zoom, so the screen zooms while a camera overlay stays put. ' +
    'A multicam zoom without source zooms the whole composite, overlays included.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoom: zoomRegionInputSchema, time: zoomClockSchema }),
  reduce: (project, payload) => {
    if (payload.time === 'timeline') return addAcrossPieces(project, payload.elementId, resolveZoomRegion(payload.zoom, payload.zoom.id ?? createZoomId()))
    return withZooms(project, payload.elementId, (zooms) => {
      const id = payload.zoom.id ?? createZoomId()
      if (zooms.some((z) => z.id === id)) throw new CommandError('invalid-payload', `zoom "${id}" already exists`)
      const touched = resolveZoomRegion(payload.zoom, id)
      return { zooms: [...zooms, touched], touched }
    })
  },
})

export const updateZoomRegion = defineCommand({
  type: 'updateZoomRegion',
  description:
    'Patch one zoom region: timing (atMs, inMs, holdMs, outMs), target (focus and scale, or rect), easing, or motionBlur. ' +
    'With time "timeline", atMs is project timeline ms. The zoom must still overlap this element, so a copy spread over a cut stays editable. ' +
    'Each copy of a spread zoom updates on its own.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoomId: z.string().min(1), patch: zoomRegionPatchSchema, time: zoomClockSchema }),
  reduce: (project, payload) =>
    withZooms(
      project,
      payload.elementId,
      (zooms, element) => {
        const { atMs } = payload.patch
        const patch = payload.time === 'timeline' && atMs !== undefined ? { ...payload.patch, atMs: atMs - element.startMs } : payload.patch
        const touched = patchZoomRegion(mustFind(zooms, payload.zoomId), patch)
        return { zooms: zooms.map((z) => (z.id === touched.id ? touched : z)), touched }
      },
      'overlap',
    ),
})

export const removeZoomRegion = defineCommand({
  type: 'removeZoomRegion',
  description: 'Remove one zoom region from an element.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoomId: z.string().min(1) }),
  reduce: (project, payload) =>
    withZooms(project, payload.elementId, (zooms) => {
      mustFind(zooms, payload.zoomId)
      return { zooms: zooms.filter((z) => z.id !== payload.zoomId), touched: null }
    }),
})

export const zoomCommandSchema = z.discriminatedUnion('type', [
  addZoomRegion.payloadSchema.extend({ type: z.literal(addZoomRegion.type) }),
  updateZoomRegion.payloadSchema.extend({ type: z.literal(updateZoomRegion.type) }),
  removeZoomRegion.payloadSchema.extend({ type: z.literal(removeZoomRegion.type) }),
])
