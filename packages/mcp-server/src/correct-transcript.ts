import { applyCommand, CommandError, elementIdSchema, getProjectCaptions, parseProject, type BuiltinCommand, type CaptionElement, type Project } from '@mcut/timeline'
import { correctCaptions } from '@mcut/transcription'
import type { z } from 'zod'
import type { MCP_TOOL_INPUTS } from './contract'
import type { StoredTranscripts } from './stored-transcripts'

type CorrectTranscriptInput = z.infer<(typeof MCP_TOOL_INPUTS)['correct_transcript']>

interface CorrectionTarget {
  getProject(): unknown | Promise<unknown>
  applyCommands(commands: BuiltinCommand[]): unknown | Promise<unknown>
}

function correctionCommands(project: Project, find: string, replace: string): { commands: BuiltinCommand[]; count: number } {
  const byTrack = new Map<string, CaptionElement[]>()
  for (const { trackId, caption } of getProjectCaptions(project)) byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), caption])
  const removals: BuiltinCommand[] = []
  const updates: BuiltinCommand[] = []
  let count = 0
  for (const captions of byTrack.values()) {
    const correction = correctCaptions(captions, find, replace)
    count += correction.count
    removals.push(...correction.removedIds.map((captionId): BuiltinCommand => ({ type: 'removeElement', elementId: elementIdSchema.parse(captionId) })))
    updates.push(
      ...correction.patches.map(({ captionId, text, words, startMs, durationMs }): BuiltinCommand => ({
        type: 'updateElement',
        elementId: elementIdSchema.parse(captionId),
        patch: { text, words: words ?? [], startMs, durationMs },
      })),
    )
  }
  return { commands: [...removals, ...updates], count }
}

interface Correction {
  find: string
  replace: string
}

function correctionsOf(input: CorrectTranscriptInput): Correction[] {
  if (input.corrections !== undefined) return input.corrections
  if (input.find === undefined || input.replace === undefined) throw new CommandError('invalid-payload', 'correct_transcript takes find and replace, or a corrections list.')
  return [{ find: input.find, replace: input.replace }]
}

export async function correctTranscriptOn(target: CorrectionTarget, transcripts: StoredTranscripts, input: CorrectTranscriptInput): Promise<string> {
  const corrections = correctionsOf(input)
  let project = parseProject(await target.getProject())
  const commands: BuiltinCommand[] = []
  const counts: number[] = []
  for (const { find, replace } of corrections) {
    const planned = correctionCommands(project, find, replace)
    project = planned.commands.reduce(applyCommand, project)
    commands.push(...planned.commands)
    counts.push(planned.count)
  }
  if (commands.length > 0) await target.applyCommands(commands)
  const lines = corrections.map(({ find, replace }, i) => {
    const count = counts[i] ?? 0
    const stored = transcripts.correct(find, replace)
    const storedNote = stored > 0 ? `, and ${stored} in the transcript stored for apply_captions` : ''
    return { matched: count > 0 || stored > 0, text: `replaced ${count} match(es) of "${find}" with "${replace}" in the captions${storedNote}` }
  })
  const missed = corrections.filter((_, i) => !lines[i]?.matched).map(({ find }) => `"${find}"`)
  if (missed.length === corrections.length) {
    throw new CommandError(
      'invalid-payload',
      `no whole-word match for ${missed.join(', ')} in the captions or the stored transcript. Call search_transcript with part of it to see how it was transcribed.`,
    )
  }
  const missedNote = missed.length > 0 ? ` No whole-word match for ${missed.join(', ')}.` : ''
  return `OK: ${lines.map((line) => line.text).join('; ')}, as one undo step.${missedNote}`
}
