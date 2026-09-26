import { z } from 'zod'
import { applyEdgeTrim } from '../edge-trim'
import { CommandError } from '../errors'
import { createElementId } from '../id'
import { MIN_ELEMENT_DURATION_MS, type Project, type TimelineElement } from '../model'
import { compactTimelineIfMagnetic, placementFor } from '../placement'
import { mintRightPiece } from './elements'
import { defineCommand, sortByStart } from './shared'

const timelineRangeSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
})

type TimelineRange = z.infer<typeof timelineRangeSchema>

function mergeTimelineRanges(ranges: readonly TimelineRange[]): TimelineRange[] {
  const merged: TimelineRange[] = []
  for (const range of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
    if (range.endMs <= range.startMs) {
      throw new CommandError('invalid-payload', `range ${range.startMs}-${range.endMs}ms must end after it starts`)
    }
    const previous = merged[merged.length - 1]
    if (previous && range.startMs <= previous.endMs) previous.endMs = Math.max(previous.endMs, range.endMs)
    else merged.push({ ...range })
  }
  return merged
}

function timelineEndMs(project: Project): number {
  return Math.max(0, ...project.tracks.flatMap((track) => track.elements.map((element) => element.startMs + element.durationMs)))
}

function carve(project: Project, element: TimelineElement, { startMs, endMs }: TimelineRange): TimelineElement[] {
  const elementEndMs = element.startMs + element.durationMs
  if (elementEndMs <= startMs) return [element]
  if (element.startMs >= endMs) return [{ ...element, startMs: element.startMs - (endMs - startMs) }]
  const keepHead = startMs - element.startMs >= MIN_ELEMENT_DURATION_MS
  const keepTail = elementEndMs - endMs >= MIN_ELEMENT_DURATION_MS
  if (keepHead && keepTail && (element.type === 'text' || element.type === 'image')) return [applyEdgeTrim(element, 'end', startMs - endMs)]
  const pieces: TimelineElement[] = []
  if (keepHead) {
    const left = applyEdgeTrim(element, 'end', startMs - elementEndMs)
    if ('transition' in left) delete left.transition
    pieces.push(left)
  }
  if (keepTail) {
    const right = applyEdgeTrim(element, 'start', endMs - element.startMs)
    pieces.push({ ...(keepHead ? mintRightPiece(project, right, createElementId()) : right), startMs })
  }
  return pieces
}

function removeRange(project: Project, range: TimelineRange): Project {
  const removedMs = range.endMs - range.startMs
  const tracks = project.tracks.map((track) => {
    if (track.locked) return track
    const next = { ...track, elements: sortByStart(track.elements.flatMap((element) => carve(project, element, range))) }
    placementFor(track).assertNoOverlaps(next)
    return next
  })
  const markers = project.markers
    .filter((marker) => marker.timeMs < range.startMs || marker.timeMs >= range.endMs)
    .map((marker) => (marker.timeMs >= range.endMs ? { ...marker, timeMs: marker.timeMs - removedMs } : marker))
  return { ...project, tracks, markers }
}

export const removeRanges = defineCommand({
  type: 'removeRanges',
  description:
    'Remove timeline time ranges from every unlocked track and close each gap, as one undo step. ' +
    'Clips, audio, and captions that play a range lose that span, and everything after it shifts left, so all tracks stay in sync. ' +
    'Ranges may come in any order and may overlap. A clip or caption spanning a range becomes two pieces, and a text or image element spanning one gets shorter. ' +
    'Pieces shorter than 10ms are dropped. ' +
    'Markers inside a range are removed and later markers shift.',
  payloadSchema: z.object({ ranges: z.array(timelineRangeSchema).min(1) }),
  reduce: (project, payload) => {
    const endMs = timelineEndMs(project)
    const ranges = mergeTimelineRanges(payload.ranges)
    for (const range of ranges) {
      if (range.startMs >= endMs) {
        throw new CommandError('out-of-bounds', `range ${range.startMs}-${range.endMs}ms starts at or after the timeline end (${endMs}ms)`)
      }
    }
    const next = ranges.reduceRight((current, range) => removeRange(current, { ...range, endMs: Math.min(range.endMs, endMs) }), project)
    return compactTimelineIfMagnetic(next)
  },
})
