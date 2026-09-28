import { CommandError, elementIdSchema, getProjectCaptions, parseProject, type BuiltinCommand, type CaptionElement, type Project } from '@mcut/timeline'
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

export async function correctTranscriptOn(
  target: CorrectionTarget,
  transcripts: StoredTranscripts,
  { find, replace }: CorrectTranscriptInput,
): Promise<string> {
  const { commands, count } = correctionCommands(parseProject(await target.getProject()), find, replace)
  if (commands.length > 0) await target.applyCommands(commands)
  const stored = transcripts.correct(find, replace)
  if (count === 0 && stored === 0) {
    throw new CommandError(
      'invalid-payload',
      `no whole-word match for "${find}" in the captions or the stored transcript. Call search_transcript with part of it to see how it was transcribed.`,
    )
  }
  const storedNote = stored > 0 ? `, and ${stored} in the transcript stored for apply_captions` : ''
  return `OK: replaced ${count} match(es) of "${find}" with "${replace}" in the captions as one undo step${storedNote}.`
}
