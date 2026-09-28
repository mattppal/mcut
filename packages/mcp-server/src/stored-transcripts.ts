import { z } from 'zod'
import { correctWords, type TranscriptResult } from '@mcut/transcription'
import {
  CommandError,
  elementIdSchema,
  getProjectCaptions,
  getProjectTranscript,
  isMediaClip,
  rangesOverlap,
  resolveElementAudioSource,
  type ElementId,
  type Project,
} from '@mcut/timeline'
import { captionTranscriptsMatch } from './caption-transcript-match'
import { toClipSourceWords } from './clip-source-words'
import { planSourceCaptions, sourcePieces, type SourceCaptionsPlan } from './source-captions'

interface SourceWord {
  text: string
  startMs: number
  endMs: number
}

const ensuredTranscriptSchema = z.object({ applied: z.boolean(), source: z.object({ elementId: elementIdSchema }) })

export function ensuredCapture(result: unknown): { elementId: ElementId; replace: boolean } | undefined {
  const parsed = ensuredTranscriptSchema.safeParse(result)
  return parsed.success ? { elementId: parsed.data.source.elementId, replace: parsed.data.applied } : undefined
}

const midMs = (word: SourceWord) => (word.startMs + word.endMs) / 2

function spliced(stored: readonly SourceWord[], incoming: readonly SourceWord[]): SourceWord[] {
  if (incoming.length === 0) return [...stored]
  const fromMs = incoming.reduce((min, word) => Math.min(min, word.startMs), Number.POSITIVE_INFINITY)
  const toMs = incoming.reduce((max, word) => Math.max(max, word.endMs), Number.NEGATIVE_INFINITY)
  const before = stored.filter((word) => midMs(word) < fromMs)
  const after = stored.filter((word) => midMs(word) > toMs)
  return [...before, ...incoming.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), ...after]
}

const SYNC_TOLERANCE_MS = 250

const spokenForm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

function agreesWithStored(stored: readonly SourceWord[], words: readonly SourceWord[]): boolean {
  const first = words[0]
  const last = words.at(-1)
  if (!first || !last) return false
  const nearby = stored.filter((word) => word.endMs >= first.startMs - SYNC_TOLERANCE_MS && word.startMs <= last.endMs + SYNC_TOLERANCE_MS)
  const agreeing = words.filter((word) =>
    nearby.some((other) => spokenForm(other.text) === spokenForm(word.text) && Math.abs(midMs(other) - midMs(word)) <= SYNC_TOLERANCE_MS),
  )
  return agreeing.length * 2 >= words.length
}

type Correction = readonly [find: string, replace: string]

function asCorrected(words: readonly SourceWord[], corrections: readonly Correction[]): SourceWord[] {
  return corrections.reduce((current, [find, replace]) => correctWords(current, find, replace).words, [...words])
}

function withCaptionEdits(project: Project, elementId: ElementId, stored: readonly SourceWord[], corrections: readonly Correction[]): SourceWord[] {
  const { pieces } = sourcePieces(project, elementId)
  let merged = [...stored]
  for (const { startMs, words = [] } of getProjectCaptions(project).map(({ caption }) => caption)) {
    for (const piece of pieces) {
      const pieceEndMs = piece.timelineStartMs + piece.timelineDurationMs
      const inPiece = words
        .filter((word) => startMs + word.startMs >= piece.timelineStartMs && startMs + word.endMs <= pieceEndMs)
        .map((word) => ({
          text: word.text,
          startMs: piece.sourceStartMs + startMs + word.startMs - piece.timelineStartMs,
          endMs: piece.sourceStartMs + startMs + word.endMs - piece.timelineStartMs,
        }))
      if (agreesWithStored(merged, inPiece) || agreesWithStored(merged, asCorrected(inPiece, corrections))) merged = spliced(merged, inPiece)
    }
  }
  return merged
}

function forwardSourceKey(project: Project, elementId: ElementId): string {
  const source = resolveElementAudioSource(project, elementId)
  if (!source) throw new CommandError('invalid-payload', `element "${elementId}" has no source audio`)
  if (source.timeMap) throw new CommandError('invalid-payload', `clip "${elementId}" has a time remap, so apply_captions cannot rebuild its captions`)
  if (source.reversed) throw new CommandError('invalid-payload', `clip "${elementId}" plays reversed, so its captions have no forward source time`)
  return `${source.assetId}\n${source.asset.src}`
}

function isForward(project: Project, elementId: ElementId): boolean {
  const source = resolveElementAudioSource(project, elementId)
  return source !== null && !source.timeMap && !source.reversed
}

function isCut(project: Project, elementId: ElementId): boolean {
  const assetId = resolveElementAudioSource(project, elementId)?.assetId
  const pieces = project.tracks.flatMap((track) =>
    track.elements.filter((element) => isMediaClip(element) && resolveElementAudioSource(project, element.id)?.assetId === assetId),
  )
  return pieces.length > 1
}

export class StoredTranscripts {
  readonly #bySource = new Map<string, SourceWord[]>()
  readonly #corrections: Correction[] = []

  remember(project: Project, elementId: ElementId, words: readonly SourceWord[]): void {
    if (!isForward(project, elementId) || words.length === 0) return
    const key = forwardSourceKey(project, elementId)
    this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], words))
  }

  captureCaptions(project: Project, options: { elementId: ElementId; replace: boolean }): void {
    if (!isForward(project, options.elementId)) return
    const key = forwardSourceKey(project, options.elementId)
    if (!options.replace && (this.#bySource.has(key) || isCut(project, options.elementId))) return
    const placed = getProjectTranscript(project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? [])
    const words = toClipSourceWords(project, options.elementId, placed)
    if (words.length > 0) this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], words))
  }

  replayOverUncaptioned(project: Project, elementId: ElementId): SourceCaptionsPlan | undefined {
    if (!isForward(project, elementId) || !this.#bySource.has(forwardSourceKey(project, elementId))) return undefined
    const { pieces } = sourcePieces(project, elementId)
    const captioned = getProjectCaptions(project).some(({ caption }) =>
      pieces.some((piece) => rangesOverlap(caption.startMs, caption.durationMs, piece.timelineStartMs, piece.timelineDurationMs)),
    )
    if (captioned) return undefined
    const plan = planSourceCaptions(project, this.recall(project, elementId), { elementId })
    return plan.command.captions.length > 0 ? plan : undefined
  }

  correct(find: string, replace: string): number {
    this.#corrections.push([find, replace])
    let count = 0
    for (const [key, words] of this.#bySource) {
      const corrected = correctWords(words, find, replace)
      count += corrected.count
      this.#bySource.set(key, corrected.words)
    }
    return count
  }

  recall(project: Project, elementId: ElementId): TranscriptResult {
    const stored = this.#bySource.get(forwardSourceKey(project, elementId)) ?? []
    if (stored.length === 0) {
      throw new CommandError(
        'invalid-payload',
        `no stored transcript for the audio "${elementId}" plays. Pass the full transcript. find_retakes with elementId stores one only before that audio is cut.`,
      )
    }
    const words = withCaptionEdits(project, elementId, stored, this.#corrections)
    const text = words.map((word) => word.text).join(' ')
    const captionText = getProjectCaptions(project)
      .map(({ caption }) => caption.text)
      .join(' ')
    if (captionText.trim() && !captionTranscriptsMatch(text, captionText)) {
      throw new CommandError(
        'invalid-payload',
        `the stored transcript for the audio "${elementId}" plays does not match the captions in the project, for example after an undo. Pass the full transcript.`,
      )
    }
    return { text, words, segments: [] }
  }
}
