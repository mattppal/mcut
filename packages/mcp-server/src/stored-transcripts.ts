import { z } from 'zod'
import type { TranscriptResult } from '@mcut/transcription'
import {
  CommandError,
  elementIdSchema,
  getProjectCaptions,
  getProjectTranscript,
  isMediaClip,
  resolveElementAudioSource,
  type ElementId,
  type Project,
} from '@mcut/timeline'
import { captionTranscriptsMatch } from './caption-transcript-match'
import { toClipSourceWords } from './clip-source-words'

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
  const outside = stored.filter((word) => midMs(word) < fromMs || midMs(word) > toMs)
  return [...outside, ...incoming.map(({ text, startMs, endMs }) => ({ text, startMs, endMs }))].sort((a, b) => a.startMs - b.startMs)
}

function forwardSourceKey(project: Project, elementId: ElementId): string {
  const source = resolveElementAudioSource(project, elementId)
  if (!source) throw new CommandError('invalid-payload', `element "${elementId}" has no source audio`)
  if (source.timeMap) throw new CommandError('invalid-payload', `clip "${elementId}" has a time remap, so apply_captions cannot rebuild its captions`)
  if (source.reversed) throw new CommandError('invalid-payload', `clip "${elementId}" plays reversed, so its captions have no forward source time`)
  return `${source.assetId}\n${source.asset.src}`
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

  remember(project: Project, elementId: ElementId, words: readonly SourceWord[]): void {
    const source = resolveElementAudioSource(project, elementId)
    if (!source || source.timeMap || source.reversed || words.length === 0) return
    const key = forwardSourceKey(project, elementId)
    this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], words))
  }

  captureCaptions(project: Project, options: { elementId: ElementId; replace: boolean }): void {
    const key = forwardSourceKey(project, options.elementId)
    if (!options.replace && (this.#bySource.has(key) || isCut(project, options.elementId))) return
    const placed = getProjectTranscript(project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? [])
    const words = toClipSourceWords(project, options.elementId, placed)
    if (words.length > 0) this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], words))
  }

  recall(project: Project, elementId: ElementId): TranscriptResult {
    const words = this.#bySource.get(forwardSourceKey(project, elementId)) ?? []
    if (words.length === 0) {
      throw new CommandError(
        'invalid-payload',
        `no stored transcript for the audio "${elementId}" plays. Pass the full transcript. find_retakes with elementId stores one only before that audio is cut.`,
      )
    }
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
