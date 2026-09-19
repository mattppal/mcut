import type { z } from 'zod'
import { CommandError } from '../errors'
import type { ElementId, TrackId } from '../id'
import type { Project, TimelineElement, Track } from '../model'
import { compactTimelineIfMagnetic } from '../placement'
import { getElementLocation, getTrack } from '../selectors'

export interface CommandSpec<K extends string, Shape extends z.ZodRawShape> {
  type: K
  description: string
  payloadSchema: z.ZodObject<Shape>
  reduce: (project: Project, payload: z.output<z.ZodObject<Shape>>) => Project
}

export interface CommandEntry<K extends string, Shape extends z.ZodRawShape>
  extends CommandSpec<K, Shape> {
  parse: (payload: unknown) => { type: K } & z.output<z.ZodObject<Shape>>
  apply: (project: Project, payload: unknown) => Project
}

export function defineCommand<const K extends string, Shape extends z.ZodRawShape>(
  spec: CommandSpec<K, Shape>,
): CommandEntry<K, Shape> {
  const parsePayload = (payload: unknown): z.output<z.ZodObject<Shape>> => {
    const parsed = spec.payloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new CommandError(
        'invalid-payload',
        `invalid payload for "${spec.type}": ${parsed.error.message}`,
        { cause: parsed.error },
      )
    }
    return parsed.data
  }
  return {
    ...spec,
    parse: (payload: unknown) => ({ type: spec.type, ...parsePayload(payload) }),
    apply: (project: Project, payload: unknown) => spec.reduce(project, parsePayload(payload)),
  }
}

export function mustGetTrack(project: Project, trackId: TrackId): Track {
  const track = getTrack(project, trackId)
  if (!track) throw new CommandError('unknown-track', `no track "${trackId}"`)
  return track
}

export function mustLocate(project: Project, elementId: ElementId) {
  const location = getElementLocation(project, elementId)
  if (!location) throw new CommandError('unknown-element', `no element "${elementId}"`)
  return location
}

export function replaceTrack(
  project: Project,
  trackId: TrackId,
  update: (track: Track) => Track,
): Project {
  const next = {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? update(t) : t)),
  }
  return compactTimelineIfMagnetic(next)
}

export function insertSorted(elements: TimelineElement[], element: TimelineElement): TimelineElement[] {
  const index = elements.findIndex((e) => e.startMs > element.startMs)
  if (index === -1) return [...elements, element]
  return [...elements.slice(0, index), element, ...elements.slice(index)]
}

export function mustGetLayout(project: Project, layoutId: string) {
  const layout = project.layouts.find((l) => l.id === layoutId)
  if (!layout) throw new CommandError('unknown-layout', `no layout "${layoutId}"`)
  return layout
}

export const sortByStart = (elements: TimelineElement[]): TimelineElement[] =>
  [...elements].sort((a, b) => a.startMs - b.startMs)
