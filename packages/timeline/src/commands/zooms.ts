import { z } from 'zod'
import { CommandError } from '../errors'
import { createZoomId } from '../id'
import { elementIdSchema, type Project } from '../model'
import {
  isZoomable,
  patchZoomRegion,
  resolveZoomRegion,
  zoomRegionEndMs,
  zoomRegionInputSchema,
  zoomRegionPatchSchema,
  type ZoomableElement,
  type ZoomRegion,
} from '../zoom-regions'
import { defineCommand, mustLocate, replaceTrack } from './shared'

function withZooms(project: Project, elementId: string, update: (zooms: ZoomRegion[], element: ZoomableElement) => ZoomRegion[]): Project {
  const { track, element } = mustLocate(project, elementIdSchema.parse(elementId))
  if (!isZoomable(element)) {
    throw new CommandError('invalid-payload', `"${element.type}" elements cannot zoom; use a video, image, or multicam element`)
  }
  const zooms = update([...(element.zooms ?? [])], element)
    .map((zoom) => mustFit(element, zoom))
    .sort((a, b) => a.atMs - b.atMs)
  mustNotOverlap(zooms)
  const next: ZoomableElement = { ...element, zooms }
  if (zooms.length === 0) delete next.zooms
  return replaceTrack(project, track.id, (t) => ({ ...t, elements: t.elements.map((e) => (e.id === element.id ? next : e)) }))
}

function mustFit(element: ZoomableElement, zoom: ZoomRegion): ZoomRegion {
  if (zoomRegionEndMs(zoom) > element.durationMs) {
    throw new CommandError('out-of-bounds', `zoom "${zoom.id}" ends at ${zoomRegionEndMs(zoom)}ms, past the ${element.durationMs}ms element`)
  }
  if (element.type !== 'multicam') {
    if (zoom.source !== undefined) throw new CommandError('invalid-payload', `source applies only to multicam zooms; "${element.id}" is ${element.type}`)
    return zoom
  }
  if (zoom.source === undefined) {
    const keys = element.sources.map((s) => s.key).join(', ')
    throw new CommandError('invalid-payload', `a multicam zoom needs source, one of: ${keys}`)
  }
  if (!element.sources.some((s) => s.key === zoom.source)) {
    throw new CommandError('invalid-payload', `multicam "${element.id}" has no source "${zoom.source}"`)
  }
  return zoom
}

function mustNotOverlap(zooms: readonly ZoomRegion[]): void {
  for (const [index, zoom] of zooms.entries()) {
    const clash = zooms.slice(index + 1).find((other) => other.source === zoom.source && other.atMs < zoomRegionEndMs(zoom))
    if (clash) throw new CommandError('invalid-payload', `zooms "${zoom.id}" and "${clash.id}" overlap on the same target`)
  }
}

function mustFind(zooms: readonly ZoomRegion[], zoomId: string): ZoomRegion {
  const zoom = zooms.find((z) => z.id === zoomId)
  if (!zoom) throw new CommandError('unknown-zoom', `no zoom "${zoomId}"`)
  return zoom
}

export const addZoomRegion = defineCommand({
  type: 'addZoomRegion',
  description:
    'Add a zoom region to a video, image, or multicam element: zoom in over inMs, hold, zoom out over outMs, with easing and motion blur. ' +
    'Defaults to the subtlePunchIn preset (1.15x, easeOutExpo, motion blur 0.5). ' +
    'On a multicam, source names the angle whose slots zoom, so the screen zooms while a camera overlay stays put.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoom: zoomRegionInputSchema }),
  reduce: (project, payload) =>
    withZooms(project, payload.elementId, (zooms) => {
      const id = payload.zoom.id ?? createZoomId()
      if (zooms.some((z) => z.id === id)) throw new CommandError('invalid-payload', `zoom "${id}" already exists`)
      return [...zooms, resolveZoomRegion(payload.zoom, id)]
    }),
})

export const updateZoomRegion = defineCommand({
  type: 'updateZoomRegion',
  description: 'Patch one zoom region: timing (atMs, inMs, holdMs, outMs), target (focus and scale, or rect), easing, or motionBlur.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoomId: z.string().min(1), patch: zoomRegionPatchSchema }),
  reduce: (project, payload) =>
    withZooms(project, payload.elementId, (zooms) => {
      const next = patchZoomRegion(mustFind(zooms, payload.zoomId), payload.patch)
      return zooms.map((z) => (z.id === next.id ? next : z))
    }),
})

export const removeZoomRegion = defineCommand({
  type: 'removeZoomRegion',
  description: 'Remove one zoom region from an element.',
  payloadSchema: z.object({ elementId: elementIdSchema, zoomId: z.string().min(1) }),
  reduce: (project, payload) =>
    withZooms(project, payload.elementId, (zooms) => {
      mustFind(zooms, payload.zoomId)
      return zooms.filter((z) => z.id !== payload.zoomId)
    }),
})

export const zoomCommandSchema = z.discriminatedUnion('type', [
  addZoomRegion.payloadSchema.extend({ type: z.literal(addZoomRegion.type) }),
  updateZoomRegion.payloadSchema.extend({ type: z.literal(updateZoomRegion.type) }),
  removeZoomRegion.payloadSchema.extend({ type: z.literal(removeZoomRegion.type) }),
])
