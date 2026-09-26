import { buildCaptionsCommand, type CaptionsCommandOptions, type TranscriptResult } from '@mcut/transcription'
import {
  getElementLocation,
  isMediaClip,
  MIN_ELEMENT_DURATION_MS,
  rangesOverlap,
  resolveElementAudioSource,
  type CommandOfType,
  type ElementAudioSource,
  type ElementId,
  type Project,
} from '@mcut/timeline'

type Caption = CommandOfType<'applyCaptions'>['captions'][number]

export interface SourceCaptionsPlan {
  command: CommandOfType<'applyCaptions'>
  pieces: ElementId[]
  skipped: ElementId[]
  cleared: number
}

function sourcePieces(project: Project, elementId: ElementId): { pieces: ElementAudioSource[]; skipped: ElementId[] } {
  const location = getElementLocation(project, elementId)
  const anchor = resolveElementAudioSource(project, elementId)
  if (!location || !anchor) return { pieces: [], skipped: [] }
  const pieces: ElementAudioSource[] = []
  const skipped: ElementId[] = []
  for (const element of location.track.elements) {
    const source = isMediaClip(element) ? resolveElementAudioSource(project, element.id) : null
    if (!source || source.assetId !== anchor.assetId) continue
    if (source.timeMap || source.reversed) skipped.push(element.id)
    else pieces.push(source)
  }
  return { pieces, skipped }
}

function withoutOverlaps(captions: Caption[]): Caption[] {
  const sorted = [...captions].sort((a, b) => a.startMs - b.startMs)
  let previousEndMs = 0
  return sorted.map((caption) => {
    const endMs = caption.startMs + caption.durationMs
    const startMs = Math.max(caption.startMs, previousEndMs)
    const shiftMs = startMs - caption.startMs
    const durationMs = Math.max(MIN_ELEMENT_DURATION_MS, endMs - startMs)
    previousEndMs = startMs + durationMs
    if (shiftMs === 0) return caption
    return {
      ...caption,
      startMs,
      durationMs,
      ...(caption.words
        ? { words: caption.words.map((word) => ({ ...word, startMs: Math.max(0, word.startMs - shiftMs), endMs: Math.max(0, word.endMs - shiftMs) })) }
        : {}),
    }
  })
}

function staleCaptionIds(project: Project, pieces: readonly ElementAudioSource[]): ElementId[] {
  const audible = project.tracks.flatMap((track) => track.elements.filter((element) => resolveElementAudioSource(project, element.id) !== null))
  const ids: ElementId[] = []
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== 'caption') continue
      const overPiece = pieces.some((piece) => rangesOverlap(element.startMs, element.durationMs, piece.timelineStartMs, piece.timelineDurationMs))
      const overAudio = audible.some((clip) => rangesOverlap(element.startMs, element.durationMs, clip.startMs, clip.durationMs))
      if (overPiece || !overAudio) ids.push(element.id)
    }
  }
  return ids
}

export function sourceCaptionsNote(plan: SourceCaptionsPlan): string {
  const skipped = plan.skipped.length > 0 ? ` Skipped ${plan.skipped.join(', ')}, which play with a speed change or in reverse.` : ''
  return ` over ${plan.pieces.length} piece(s) of this source (${plan.pieces.join(', ')}), replacing ${plan.cleared} old caption(s).${skipped}`
}

export function planSourceCaptions(
  project: Project,
  transcript: TranscriptResult,
  options: CaptionsCommandOptions & { elementId: ElementId },
): SourceCaptionsPlan {
  const { replace, ...rest } = options
  buildCaptionsCommand(project, transcript, { ...rest, replace: false })
  const { pieces, skipped } = sourcePieces(project, options.elementId)
  const perPiece = pieces.map((piece) => ({
    piece,
    captions: buildCaptionsCommand(project, transcript, { ...rest, elementId: piece.elementId, replace: false }).captions,
  }))
  const captions = perPiece.flatMap((entry) => entry.captions)
  const spoken = perPiece.filter((entry) => entry.captions.length > 0).map((entry) => entry.piece)
  const replaceIds = replace === false ? [] : staleCaptionIds(project, spoken)
  return {
    command: { type: 'applyCaptions', replace: false, replaceIds, captions: withoutOverlaps(captions) },
    pieces: pieces.map((piece) => piece.elementId),
    skipped,
    cleared: replaceIds.length,
  }
}
