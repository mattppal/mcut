import { z } from 'zod'
import { CommandError } from './errors'
import type { MulticamElement, Project, TimelineElement } from './model'
import { getActiveAngleIndex, getVisibleAngleCuts } from './multicam'
import { getSourceTimeMs } from './speed'

export const angleClockSchema = z
  .enum(['source', 'timeline'])
  .describe(
    'Clock for the cut times. "timeline" is project timeline ms, where the playhead sits and get_summary lists cuts, and must fall inside this piece. ' +
      '"source" is the synced group clock, the only clock a reversed piece takes. Omitted means "source" in the SDK; the MCP server fills in "timeline".',
  )
  .optional()

export type AngleClock = z.infer<typeof angleClockSchema>

function sourceWindow(element: MulticamElement): { lowMs: number; highMs: number } {
  const inPointMs = getSourceTimeMs(element, 0)
  const outPointMs = getSourceTimeMs(element, element.durationMs)
  return { lowMs: Math.min(inPointMs, outPointMs), highMs: Math.max(inPointMs, outPointMs) }
}

function pieceAt(project: Project, element: MulticamElement, timelineMs: number): TimelineElement | undefined {
  const track = project.tracks.find((t) => t.elements.some((e) => e.id === element.id))
  return track?.elements.find((e) => e.type === 'multicam' && timelineMs >= e.startMs && timelineMs < e.startMs + e.durationMs)
}

function outsidePiece(project: Project, element: MulticamElement, timelineMs: number): CommandError {
  const endMs = element.startMs + element.durationMs
  const other = pieceAt(project, element, timelineMs)
  const hint = other ? ` That time is on "${other.id}"; cut that piece instead.` : ''
  return new CommandError(
    'out-of-bounds',
    `timeline ${timelineMs}ms is outside "${element.id}", which plays timeline ${element.startMs} to ${endMs}ms, so the cut would never show.${hint}`,
  )
}

function mustPlayForward(element: MulticamElement): void {
  if (element.reversed) {
    throw new CommandError('unsupported', `"${element.id}" plays reversed, so give its cut times with time "source", read from its angles list`)
  }
}

export function resolveCutTime(project: Project, element: MulticamElement, ms: number, time: AngleClock): number {
  if (time === 'timeline') {
    mustPlayForward(element)
    if (ms < element.startMs || ms >= element.startMs + element.durationMs) throw outsidePiece(project, element, ms)
    return Math.floor(getSourceTimeMs(element, ms - element.startMs))
  }
  const { lowMs, highMs } = sourceWindow(element)
  if (ms < lowMs || ms > highMs) {
    throw new CommandError(
      'out-of-bounds',
      `source ${ms}ms is outside "${element.id}", which plays source ${lowMs} to ${highMs}ms, so the cut would never show. ` +
        'Pass time "timeline" to give the cut in timeline ms.',
    )
  }
  return ms
}

export function findCut(project: Project, element: MulticamElement, ms: number, time: AngleClock): { index: number; opening: boolean } {
  if (time !== 'timeline') {
    const index = element.angles.findIndex((a) => a.atMs === ms)
    if (index === -1) throw new CommandError('unknown-cut', `no cut at source ${ms}ms`)
    return { index, opening: index === 0 }
  }
  mustPlayForward(element)
  const frameMs = 1000 / project.fps
  const cuts = getVisibleAngleCuts(element).map((cut) => ({ atMs: cut.atMs, timelineMs: Math.round(element.startMs + cut.localMs) }))
  const nearest = cuts.reduce<(typeof cuts)[number] | undefined>(
    (best, cut) => (!best || Math.abs(cut.timelineMs - ms) < Math.abs(best.timelineMs - ms) ? cut : best),
    undefined,
  )
  if (!nearest || Math.abs(nearest.timelineMs - ms) > frameMs) {
    throw new CommandError(
      'unknown-cut',
      `no cut on "${element.id}" at timeline ${ms}ms; its cuts are at timeline ${cuts.map((c) => `${c.timelineMs}ms`).join(', ')}`,
    )
  }
  return { index: element.angles.findIndex((a) => a.atMs === nearest.atMs), opening: nearest === cuts[0] }
}

export function withAnglesInWindow(element: TimelineElement): TimelineElement {
  if (element.type !== 'multicam') return element
  const { lowMs, highMs } = sourceWindow(element)
  const openIndex = getActiveAngleIndex(element.angles, lowMs)
  const closeIndex = element.reversed ? getActiveAngleIndex(element.angles, highMs) : -1
  const played = element.angles.flatMap((a, i) => (i === openIndex || i === closeIndex || (a.atMs > lowMs && a.atMs < highMs) ? [i] : []))
  const reach = element.angleTransition ? 2 : 0
  const first = Math.max(0, Math.min(...played) - reach)
  const last = Math.max(...played) + reach
  return { ...element, angles: element.angles.slice(first, last + 1) }
}
