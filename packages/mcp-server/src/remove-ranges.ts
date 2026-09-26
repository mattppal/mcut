import { CommandError, getElementLocation, parseProject, type BuiltinCommand, type CommandOfType, type ElementId, type Project } from '@mcut/timeline'
import type { z } from 'zod'
import type { MCP_TOOL_INPUTS } from './contract'
import { sourcePieces } from './source-captions'

type RemoveRangesInput = z.infer<(typeof MCP_TOOL_INPUTS)['remove_ranges']>

interface Range {
  startMs: number
  endMs: number
}

function sourceToTimeline(project: Project, elementId: ElementId, ranges: readonly Range[]): Range[] {
  if (!getElementLocation(project, elementId)) throw new CommandError('unknown-element', `no element "${elementId}" in project`)
  const { pieces, skipped } = sourcePieces(project, elementId)
  const skippedNote =
    skipped.length > 0 ? ` Skipped ${skipped.join(', ')}, which play with a speed change or in reverse, so pass timeline ranges for them.` : ''
  if (pieces.length === 0) {
    throw new CommandError(
      'invalid-payload',
      `remove_ranges with time "source" needs a clip with source audio playing forward at 1x, got "${elementId}".${skippedNote}`,
    )
  }
  return ranges.flatMap((range) => {
    const mapped = pieces.flatMap((piece) => {
      const startMs = Math.max(range.startMs, piece.sourceStartMs)
      const endMs = Math.min(range.endMs, piece.sourceEndMs)
      if (endMs <= startMs) return []
      const toTimeline = (sourceMs: number) => piece.timelineStartMs + (sourceMs - piece.sourceStartMs)
      return [{ startMs: toTimeline(startMs), endMs: toTimeline(endMs) }]
    })
    if (mapped.length === 0) {
      throw new CommandError('out-of-bounds', `source range ${range.startMs}-${range.endMs}ms is not played by any piece of "${elementId}".${skippedNote}`)
    }
    return mapped
  })
}

function planRangeRemoval(project: Project, input: RemoveRangesInput): CommandOfType<'removeRanges'> {
  const rounded = input.ranges.map((range) => ({ startMs: Math.max(0, Math.round(range.startMs)), endMs: Math.round(range.endMs) }))
  if (input.time !== 'source') {
    if (input.elementId)
      throw new CommandError(
        'invalid-payload',
        'remove_ranges reads elementId only with time "source". Omit it for timeline ranges such as find_retakes candidates.',
      )
    return { type: 'removeRanges', ranges: rounded }
  }
  if (!input.elementId) throw new CommandError('invalid-payload', 'remove_ranges with time "source" needs elementId')
  return { type: 'removeRanges', ranges: sourceToTimeline(project, input.elementId, rounded) }
}

function durationMs(project: Project): number {
  return Math.max(0, ...project.tracks.flatMap((track) => track.elements.map((element) => element.startMs + element.durationMs)))
}

interface RangeTarget {
  getProject(): unknown | Promise<unknown>
  getSummary(): string | Promise<string>
  applyCommands(commands: BuiltinCommand[]): unknown | Promise<unknown>
}

export async function removeRangesOn(target: RangeTarget, input: RemoveRangesInput): Promise<string> {
  const before = parseProject(await target.getProject())
  const command = planRangeRemoval(before, input)
  await target.applyCommands([command])
  const after = parseProject(await target.getProject())
  return (
    `OK: ${command.ranges.length} range(s) removed as one undo step. The timeline went from ${durationMs(before)}ms to ${durationMs(after)}ms. ` +
    'Captions were cut and shifted with the clips. To rebuild them from the stored transcript, call apply_captions with elementId set to any remaining piece, replace true, and no transcript.' +
    `\n\n${await target.getSummary()}`
  )
}
