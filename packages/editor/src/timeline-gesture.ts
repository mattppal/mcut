import {
  createElementId as createTimelineElementId,
  createTrackId as createTimelineTrackId,
  getElementLocation,
  getSourceSpanMs,
  rangesOverlap,
  type AnyCommand,
  type ElementId,
  type Project,
  type TimelineElement,
  type Track,
} from '@mcut/timeline'

export type ClipDragMode =
  | 'move'
  | 'trim-start'
  | 'trim-end'
  | 'ripple-start'
  | 'ripple-end'
  | 'roll-start'
  | 'roll-end'
  | 'slip'
  | 'slide'

export interface ClipDragBase {
  startMs: number
  durationMs: number
  trimStartMs?: number
  /** Plays its source span backward, so edge trims consume the other end. */
  reversed?: boolean
  /** Speed-mapped clips freeze edge growth at the map boundary. */
  hasTimeMap?: boolean
  trackIndex: number
}

export interface ResolvedClipDragMode {
  mode: ClipDragMode
  rollTargetId: ElementId | null
}

export interface DuplicateClipsToNewTracksPlan {
  commands: AnyCommand[]
  ids: ElementId[]
  createdTrackIds: Track['id'][]
}

export interface DuplicateClipsToNewTracksOptions {
  createTrackId?: () => Track['id']
  createElementId?: () => ElementId
}

export interface AutoCrossfadePlanInput {
  elementId: ElementId
  desiredStartMs: number
  minAttemptedOverlapMs?: number
  maxAttemptedOverlapMs?: number
  minDurationMs?: number
  maxDurationMs?: number
  transitionType?: string
}

export function canPlaceIgnoring(
  track: Track,
  startMs: number,
  durationMs: number,
  ignore: ReadonlySet<string>,
): boolean {
  if (startMs < 0) return false
  return !track.elements.some(
    (e) => !ignore.has(e.id) && rangesOverlap(startMs, durationMs, e.startMs, e.durationMs),
  )
}

export function collectClipDragBases(
  project: Project,
  ids: readonly ElementId[],
): Map<ElementId, ClipDragBase> {
  const bases = new Map<ElementId, ClipDragBase>()
  for (const id of ids) {
    for (let t = 0; t < project.tracks.length; t++) {
      const found = project.tracks[t]!.elements.find((e) => e.id === id)
      if (found) {
        bases.set(id, {
          startMs: found.startMs,
          durationMs: found.durationMs,
          ...('trimStartMs' in found ? { trimStartMs: found.trimStartMs } : {}),
          ...('reversed' in found && found.reversed === true ? { reversed: true } : {}),
          ...('timeMap' in found && Array.isArray(found.timeMap) && found.timeMap.length >= 2
            ? { hasTimeMap: true }
            : {}),
          trackIndex: t,
        })
        break
      }
    }
  }
  return bases
}

/**
 * Tool gestures degrade gracefully when their structural requirements are not met.
 */
export function resolveToolMode(
  project: Project,
  mode: ClipDragMode,
  ids: readonly ElementId[],
): ResolvedClipDragMode {
  const fallback = (m: ClipDragMode): ResolvedClipDragMode => ({ mode: m, rollTargetId: null })
  const anchorId = ids[0]
  if (!anchorId) return fallback(mode)
  const anchor = getElementLocation(project, anchorId)
  if (!anchor) return fallback(mode)
  const { track, element } = anchor
  const previous = track.elements.find(
    (e) => e.startMs + e.durationMs === element.startMs && e.id !== element.id,
  )
  const next = track.elements.find(
    (e) => e.startMs === element.startMs + element.durationMs && e.id !== element.id,
  )
  switch (mode) {
    case 'roll-start':
      return previous ? { mode, rollTargetId: previous.id } : fallback('trim-start')
    case 'roll-end':
      return next ? { mode, rollTargetId: element.id } : fallback('trim-end')
    case 'slide':
      return previous && next ? fallback(mode) : fallback('move')
    case 'slip':
      return element.type === 'video' || element.type === 'audio' || element.type === 'multicam'
        ? fallback(mode)
        : fallback('move')
    default:
      return fallback(mode)
  }
}

/** How far the gesture's slippable members can slip without running out of media. */
export function computeSlipRange(
  project: Project,
  ids: readonly ElementId[],
): { minMs: number; maxMs: number } {
  let minMs = -Infinity
  let maxMs = Infinity
  for (const id of ids) {
    const element = getElementLocation(project, id)?.element
    if (!element) continue
    if (element.type === 'video' || element.type === 'audio') {
      minMs = Math.max(minMs, -element.trimStartMs)
      const assetDurationMs = project.assets[element.assetId]?.durationMs
      if (assetDurationMs !== undefined) {
        maxMs = Math.min(maxMs, assetDurationMs - element.trimStartMs - getSourceSpanMs(element))
      }
    } else if (element.type === 'multicam') {
      for (const source of element.sources) {
        minMs = Math.max(minMs, -source.trimStartMs)
        const assetDurationMs = project.assets[source.assetId]?.durationMs
        if (assetDurationMs !== undefined) {
          maxMs = Math.min(maxMs, assetDurationMs - source.trimStartMs - element.durationMs)
        }
      }
    }
  }
  return { minMs: Math.min(0, minMs), maxMs: Math.max(0, maxMs) }
}

export function planDuplicateClipsToNewTracks(
  project: Project,
  ids: readonly ElementId[],
  options: DuplicateClipsToNewTracksOptions = {},
): DuplicateClipsToNewTracksPlan | null {
  const groups = new Map<number, TimelineElement[]>()
  for (const id of ids) {
    const location = getElementLocation(project, id)
    if (!location) continue
    const trackIndex = project.tracks.findIndex((track) => track.id === location.track.id)
    if (trackIndex === -1) continue
    groups.set(trackIndex, [...(groups.get(trackIndex) ?? []), location.element])
  }
  if (groups.size === 0) return null

  const makeTrackId = options.createTrackId ?? createTimelineTrackId
  const makeElementId = options.createElementId ?? createTimelineElementId
  const idMap = new Map<ElementId, ElementId>()
  const createdTrackIds: Track['id'][] = []
  const commands: AnyCommand[] = []
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a - b)

  for (const [, elements] of sortedGroups) {
    const trackId = makeTrackId()
    createdTrackIds.push(trackId)
    commands.push({ type: 'addTrack', id: trackId })
    for (const element of elements) {
      const id = makeElementId()
      idMap.set(element.id, id)
      commands.push({
        type: 'addElement',
        trackId,
        element: { ...element, id },
      })
    }
  }

  const duplicatedIds = ids.map((id) => idMap.get(id)).filter((id): id is ElementId => Boolean(id))
  return { commands, ids: duplicatedIds, createdTrackIds }
}

export function planAutoCrossfade(
  project: Project,
  input: AutoCrossfadePlanInput,
): AnyCommand | null {
  const location = getElementLocation(project, input.elementId)
  if (!location || location.track.magnetic) return null

  const {
    desiredStartMs,
    minAttemptedOverlapMs = 40,
    maxAttemptedOverlapMs = 2000,
    minDurationMs = 100,
    maxDurationMs = 1000,
    transitionType = 'dissolve',
  } = input
  const { track, element } = location
  const previous = track.elements.find(
    (e) => e.startMs + e.durationMs === element.startMs && e.id !== element.id,
  )
  const next = track.elements.find(
    (e) => e.startMs === element.startMs + element.durationMs && e.id !== element.id,
  )
  const commandFor = (left: TimelineElement, attemptedOverlapMs: number): AnyCommand | null => {
    if (attemptedOverlapMs < minAttemptedOverlapMs || attemptedOverlapMs > maxAttemptedOverlapMs) {
      return null
    }
    if ('transition' in left && left.transition) return null
    return {
      type: 'setTransition',
      elementId: left.id,
      transition: {
        type: transitionType,
        durationMs: Math.max(minDurationMs, Math.min(maxDurationMs, Math.round(attemptedOverlapMs))),
      },
    }
  }

  if (previous && desiredStartMs < element.startMs) {
    return commandFor(previous, element.startMs - desiredStartMs)
  }
  if (next && desiredStartMs > element.startMs) {
    return commandFor(element, desiredStartMs - element.startMs)
  }
  return null
}
