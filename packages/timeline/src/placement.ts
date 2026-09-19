import { CommandError } from './errors'
import type { ElementId } from './id'
import type { Project, TimelineElement, Track } from './model'

export type EditMode = 'normal' | 'overwrite' | 'insert'

export interface PlacementPolicy {
  place(track: Track, element: TimelineElement): TimelineElement[]
  remove(track: Track, elementId: ElementId): TimelineElement[]
  editMode(requested: EditMode): EditMode
  assertCanPlace(track: Track, element: TimelineElement): void
  assertNoOverlaps(track: Track): void
}

export function rangesOverlap(aStartMs: number, aDurationMs: number, bStartMs: number, bDurationMs: number): boolean {
  return aStartMs < bStartMs + bDurationMs && bStartMs < aStartMs + aDurationMs
}

const withoutId = (elements: TimelineElement[], elementId: ElementId): TimelineElement[] => elements.filter((e) => e.id !== elementId)

function findConflict(elements: TimelineElement[], startMs: number, durationMs: number): TimelineElement | undefined {
  return elements.find((e) => rangesOverlap(startMs, durationMs, e.startMs, e.durationMs))
}

export function canPlace(track: Track, startMs: number, durationMs: number, ignoreElementId?: ElementId): boolean {
  if (startMs < 0) return false
  const others = ignoreElementId === undefined ? track.elements : withoutId(track.elements, ignoreElementId)
  return findConflict(others, startMs, durationMs) === undefined
}

function insertAtSlot(elements: TimelineElement[], element: TimelineElement): TimelineElement[] {
  const index = elements.findIndex((e) => e.startMs >= element.startMs)
  if (index === -1) return [...elements, element]
  return [...elements.slice(0, index), element, ...elements.slice(index)]
}

function slotFor(track: Track, element: TimelineElement): TimelineElement {
  let boundaryMs = 0
  for (const other of withoutId(track.elements, element.id)) {
    if (element.startMs < boundaryMs + other.durationMs / 2) break
    boundaryMs += other.durationMs
  }
  return { ...element, startMs: boundaryMs }
}

export function compactElements(elements: TimelineElement[]): TimelineElement[] {
  let cursorMs = 0
  return [...elements]
    .sort((a, b) => a.startMs - b.startMs)
    .map((element) => {
      const startMs = cursorMs
      cursorMs += element.durationMs
      return element.startMs === startMs ? element : { ...element, startMs }
    })
}

export function compactAllTracks(project: Project): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, elements: compactElements(track.elements) })),
  }
}

export const isTimelineMagnetic = (project: Project): boolean => project.tracks.some((track) => track.magnetic)

export function compactTimelineIfMagnetic(project: Project): Project {
  return isTimelineMagnetic(project) ? compactAllTracks(project) : project
}

const gapped: PlacementPolicy = {
  place: (track, element) => insertAtSlot(withoutId(track.elements, element.id), element),
  remove: (track, elementId) => withoutId(track.elements, elementId),
  editMode: (requested) => requested,
  assertCanPlace: (track, element) => {
    const conflict = findConflict(withoutId(track.elements, element.id), element.startMs, element.durationMs)
    if (conflict) {
      throw new CommandError(
        'overlap',
        `element would overlap "${conflict.id}" on track "${track.id}" ` + `(use findNearestFreeSlot to clamp before dispatching)`,
      )
    }
  },
  assertNoOverlaps: (track) => {
    for (const [index, current] of track.elements.entries()) {
      const previous = track.elements[index - 1]
      if (previous && previous.startMs + previous.durationMs > current.startMs) {
        throw new CommandError('overlap', `edit would overlap "${previous.id}" and "${current.id}" on track "${track.id}"`)
      }
    }
  },
}

const magnetic: PlacementPolicy = {
  place: (track, element) => compactElements(insertAtSlot(withoutId(track.elements, element.id), slotFor(track, element))),
  remove: (track, elementId) => compactElements(withoutId(track.elements, elementId)),
  editMode: () => 'normal',
  assertCanPlace: () => {},
  assertNoOverlaps: () => {},
}

export const placementFor = (track: Track): PlacementPolicy => (track.magnetic ? magnetic : gapped)
