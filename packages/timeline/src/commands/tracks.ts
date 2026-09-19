import { z } from 'zod'
import { CommandError } from '../errors'
import { createTrackId } from '../id'
import { trackIdSchema, type Track } from '../model'
import { compactAllTracks, compactElements, isTimelineMagnetic } from '../placement'
import { defineCommand, mustGetTrack, replaceTrack } from './shared'

const addTrackSchema = z.object({
  id: trackIdSchema.optional(),
  name: z.string().optional(),
  index: z.number().int().nonnegative().optional(),
})

export const addTrack = defineCommand({
  type: 'addTrack',
  description: 'Add a new track. Tracks later in the list render on top.',
  payloadSchema: addTrackSchema,
  reduce: (project, payload) => {
    const track: Track = {
      id: payload.id ?? createTrackId(),
      name: payload.name ?? `Track ${project.tracks.length + 1}`,
      muted: false,
      hidden: false,
      locked: false,
      magnetic: isTimelineMagnetic(project),
      elements: [],
    }
    if (project.tracks.some((t) => t.id === track.id)) {
      throw new CommandError('duplicate-track', `track "${track.id}" already exists`)
    }
    const index = Math.min(payload.index ?? project.tracks.length, project.tracks.length)
    const tracks = [...project.tracks.slice(0, index), track, ...project.tracks.slice(index)]
    return { ...project, tracks }
  },
})

export const removeTrack = defineCommand({
  type: 'removeTrack',
  description: 'Remove a track and all elements on it.',
  payloadSchema: z.object({ trackId: trackIdSchema }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return { ...project, tracks: project.tracks.filter((t) => t.id !== payload.trackId) }
  },
})

export const renameTrack = defineCommand({
  type: 'renameTrack',
  description: 'Rename a track.',
  payloadSchema: z.object({ trackId: trackIdSchema, name: z.string().min(1) }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({ ...t, name: payload.name }))
  },
})

export const setTrackFlags = defineCommand({
  type: 'setTrackFlags',
  description: 'Mute (audio), hide (visuals), lock, or magnetically compact a track.',
  payloadSchema: z.object({
    trackId: trackIdSchema,
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    magnetic: z.boolean().optional(),
  }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({
      ...t,
      muted: payload.muted ?? t.muted,
      hidden: payload.hidden ?? t.hidden,
      locked: payload.locked ?? t.locked,
      magnetic: payload.magnetic ?? t.magnetic,
    }))
  },
})

export const compactTrackGaps = defineCommand({
  type: 'compactTrackGaps',
  description: 'Close every gap on one track by packing clips left in timeline order.',
  payloadSchema: z.object({ trackId: trackIdSchema }),
  reduce: (project, payload) => {
    mustGetTrack(project, payload.trackId)
    return replaceTrack(project, payload.trackId, (t) => ({ ...t, elements: compactElements(t.elements) }))
  },
})

export const compactTimelineGaps = defineCommand({
  type: 'compactTimelineGaps',
  description: 'Close every gap on the timeline by packing clips left on every track.',
  payloadSchema: z.object({}),
  reduce: (project) => compactAllTracks(project),
})

export const reorderTrack = defineCommand({
  type: 'reorderTrack',
  description: 'Move a track to a new position in the paint order.',
  payloadSchema: z.object({ trackId: trackIdSchema, toIndex: z.number().int().nonnegative() }),
  reduce: (project, payload) => {
    const from = project.tracks.findIndex((t) => t.id === payload.trackId)
    if (from === -1) throw new CommandError('unknown-track', `no track "${payload.trackId}"`)
    const to = Math.min(payload.toIndex, project.tracks.length - 1)
    if (from === to) return project
    const tracks = [...project.tracks]
    const [track] = tracks.splice(from, 1)
    tracks.splice(to, 0, track!)
    return { ...project, tracks }
  },
})
