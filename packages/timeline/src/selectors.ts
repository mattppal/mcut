import type { ElementId, TrackId } from './id'
import type { Project, TimelineElement, Track } from './model'
import { canPlace } from './placement'

export interface ElementLocation {
  track: Track
  trackIndex: number
  element: TimelineElement
  elementIndex: number
}

export function getTrack(project: Project, trackId: TrackId): Track | undefined {
  return project.tracks.find((t) => t.id === trackId)
}

export function getElementLocation(
  project: Project,
  elementId: ElementId,
): ElementLocation | undefined {
  for (const [trackIndex, track] of project.tracks.entries()) {
    for (const [elementIndex, element] of track.elements.entries()) {
      if (element.id === elementId) return { track, trackIndex, element, elementIndex }
    }
  }
  return undefined
}

export function getElement(project: Project, elementId: ElementId): TimelineElement | undefined {
  return getElementLocation(project, elementId)?.element
}

export function getLinkedElementIds(project: Project, elementId: ElementId): ElementId[] {
  const element = getElement(project, elementId)
  if (!element?.linkId) return [elementId]
  const partners: ElementId[] = []
  for (const track of project.tracks) {
    for (const e of track.elements) {
      if (e.linkId === element.linkId && e.id !== elementId) partners.push(e.id)
    }
  }
  return [elementId, ...partners]
}

export function getGroupedElementIds(project: Project, elementId: ElementId): ElementId[] {
  const element = getElement(project, elementId)
  if (!element?.groupId) return [elementId]
  const members: ElementId[] = []
  for (const track of project.tracks) {
    for (const e of track.elements) {
      if (e.groupId === element.groupId && e.id !== elementId) members.push(e.id)
    }
  }
  return [elementId, ...members]
}

export function getProjectDurationMs(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    const last = track.elements.at(-1)
    if (last) end = Math.max(end, last.startMs + last.durationMs)
  }
  return end
}

export function isElementActiveAt(element: TimelineElement, timeMs: number): boolean {
  return timeMs >= element.startMs && timeMs < element.startMs + element.durationMs
}

export interface ActiveElement {
  track: Track
  trackIndex: number
  element: TimelineElement
}

export function getActiveElements(project: Project, timeMs: number): ActiveElement[] {
  const active: ActiveElement[] = []
  for (const [trackIndex, track] of project.tracks.entries()) {
    for (const element of track.elements) {
      if (element.startMs > timeMs) break
      if (isElementActiveAt(element, timeMs)) active.push({ track, trackIndex, element })
    }
  }
  return active
}

export function findNearestFreeSlot(
  track: Track,
  desiredStartMs: number,
  durationMs: number,
  ignoreElementId?: ElementId,
): number {
  const desired = Math.max(0, Math.round(desiredStartMs))
  if (canPlace(track, desired, durationMs, ignoreElementId)) return desired

  const others = track.elements.filter((e) => e.id !== ignoreElementId)
  const candidates = new Set<number>([0])
  for (const e of others) {
    candidates.add(e.startMs + e.durationMs)
    candidates.add(e.startMs - durationMs)
  }
  let best: number | undefined
  for (const candidate of candidates) {
    if (candidate < 0) continue
    if (!canPlace(track, candidate, durationMs, ignoreElementId)) continue
    if (best === undefined || Math.abs(candidate - desired) < Math.abs(best - desired)) {
      best = candidate
    }
  }
  return best ?? Math.max(desired, ...others.map((e) => e.startMs + e.durationMs), 0)
}
