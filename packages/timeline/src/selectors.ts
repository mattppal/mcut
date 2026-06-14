import type { ElementId, TrackId } from './id'
import type { Project, TimelineElement, Track } from './model'

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
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex++) {
    const track = project.tracks[trackIndex]!
    const elementIndex = track.elements.findIndex((e) => e.id === elementId)
    if (elementIndex !== -1) {
      return { track, trackIndex, element: track.elements[elementIndex]!, elementIndex }
    }
  }
  return undefined
}

export function getElement(project: Project, elementId: ElementId): TimelineElement | undefined {
  return getElementLocation(project, elementId)?.element
}

/**
 * The element plus every element sharing its `linkId` (e.g. a video and its
 * detached audio), the element itself first. Just `[elementId]` when unlinked.
 */
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

/** End of the last element across all tracks (0 for an empty project). */
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

/**
 * Elements under the playhead in paint order (bottom track first).
 * Visual filtering (`track.hidden`) is the renderer's concern, audio
 * filtering (`track.muted`) the audio engine's — both are included here.
 */
export function getActiveElements(project: Project, timeMs: number): ActiveElement[] {
  const active: ActiveElement[] = []
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex++) {
    const track = project.tracks[trackIndex]!
    for (const element of track.elements) {
      if (element.startMs > timeMs) break // elements are sorted by startMs
      if (isElementActiveAt(element, timeMs)) active.push({ track, trackIndex, element })
    }
  }
  return active
}

/** Ranges `[startMs, startMs + durationMs)` overlap. */
export function rangesOverlap(
  aStartMs: number,
  aDurationMs: number,
  bStartMs: number,
  bDurationMs: number,
): boolean {
  return aStartMs < bStartMs + bDurationMs && bStartMs < aStartMs + aDurationMs
}

export function canPlace(
  track: Track,
  startMs: number,
  durationMs: number,
  ignoreElementId?: ElementId,
): boolean {
  if (startMs < 0) return false
  return !track.elements.some(
    (e) =>
      e.id !== ignoreElementId && rangesOverlap(startMs, durationMs, e.startMs, e.durationMs),
  )
}

/**
 * Nearest start position to `desiredStartMs` where `[start, start+duration)`
 * fits in `track` without overlap. Used by UIs to clamp drags before
 * dispatching; the engine itself rejects overlapping commands.
 */
export function findNearestFreeSlot(
  track: Track,
  desiredStartMs: number,
  durationMs: number,
  ignoreElementId?: ElementId,
): number {
  const desired = Math.max(0, Math.round(desiredStartMs))
  if (canPlace(track, desired, durationMs, ignoreElementId)) return desired

  const others = track.elements.filter((e) => e.id !== ignoreElementId)
  // Candidate positions: flush against each element's start or end, plus 0.
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
  // A track always has room at the end.
  return best ?? Math.max(desired, ...others.map((e) => e.startMs + e.durationMs), 0)
}
