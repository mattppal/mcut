import { z } from 'zod'
import { CommandError } from '../errors'
import { createMarkerId, type MarkerId } from '../id'
import { markerIdSchema, type Project } from '../model'
import { defineCommand } from './shared'

function mustGetMarker(project: Project, markerId: MarkerId) {
  const marker = project.markers.find((m) => m.id === markerId)
  if (!marker) throw new CommandError('unknown-marker', `no marker "${markerId}"`)
  return marker
}

const sortMarkers = (markers: Project['markers']) => [...markers].sort((a, b) => a.timeMs - b.timeMs)

export const addMarker = defineCommand({
  type: 'addMarker',
  description: 'Add a timeline marker at an absolute time. Omit `id` to have one generated.',
  payloadSchema: z.object({
    id: markerIdSchema.optional(),
    timeMs: z.number().int().nonnegative(),
    label: z.string().optional(),
    color: z.string().optional(),
  }),
  reduce: (project, payload) => {
    const id = payload.id ?? createMarkerId()
    if (project.markers.some((m) => m.id === id)) {
      throw new CommandError('duplicate-marker', `marker "${id}" already exists`)
    }
    const marker = {
      id,
      timeMs: payload.timeMs,
      ...(payload.label !== undefined ? { label: payload.label } : {}),
      ...(payload.color !== undefined ? { color: payload.color } : {}),
    }
    return { ...project, markers: sortMarkers([...project.markers, marker]) }
  },
})

export const updateMarker = defineCommand({
  type: 'updateMarker',
  description: 'Retime, relabel, or recolor a timeline marker.',
  payloadSchema: z.object({
    markerId: markerIdSchema,
    timeMs: z.number().int().nonnegative().optional(),
    label: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
  }),
  reduce: (project, payload) => {
    mustGetMarker(project, payload.markerId)
    const markers = project.markers.map((m) => {
      if (m.id !== payload.markerId) return m
      const next = { ...m, timeMs: payload.timeMs ?? m.timeMs }
      if (payload.label !== undefined) {
        if (payload.label === null) delete next.label
        else next.label = payload.label
      }
      if (payload.color !== undefined) {
        if (payload.color === null) delete next.color
        else next.color = payload.color
      }
      return next
    })
    return { ...project, markers: sortMarkers(markers) }
  },
})

export const removeMarker = defineCommand({
  type: 'removeMarker',
  description: 'Remove a timeline marker.',
  payloadSchema: z.object({ markerId: markerIdSchema }),
  reduce: (project, payload) => {
    mustGetMarker(project, payload.markerId)
    return { ...project, markers: project.markers.filter((m) => m.id !== payload.markerId) }
  },
})
