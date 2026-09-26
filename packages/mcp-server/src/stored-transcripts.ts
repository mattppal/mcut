import { z } from 'zod'
import type { TranscriptResult } from '@mcut/transcription'
import { CommandError, elementIdSchema, getProjectTranscript, isMediaClip, resolveElementAudioSource, type ElementId, type Project } from '@mcut/timeline'
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

function forwardSourceKey(project: Project, elementId: ElementId): string | undefined {
  const source = resolveElementAudioSource(project, elementId)
  if (!source || source.timeMap || source.reversed) return undefined
  return `${source.assetId}\n${source.asset.src}`
}

export class StoredTranscripts {
  readonly #bySource = new Map<string, SourceWord[]>()

  remember(project: Project, elementId: ElementId, words: readonly SourceWord[]): void {
    const key = forwardSourceKey(project, elementId)
    if (key && words.length > 0) this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], words))
  }

  captureCaptions(project: Project, options: { elementId?: ElementId; replace: boolean }): void {
    const placed = getProjectTranscript(project, { includeWords: true }).captions.flatMap((caption) => caption.words ?? [])
    if (placed.length === 0) return
    const clipIds = options.elementId
      ? [options.elementId]
      : project.tracks.flatMap((track) => track.elements.filter((element) => isMediaClip(element)).map((element) => element.id))
    const captured = new Set<string>()
    for (const clipId of clipIds) {
      const key = forwardSourceKey(project, clipId)
      if (!key || (!options.replace && this.#bySource.has(key) && !captured.has(key))) continue
      captured.add(key)
      this.#bySource.set(key, spliced(this.#bySource.get(key) ?? [], toClipSourceWords(project, clipId, placed)))
    }
  }

  recall(project: Project, elementId: ElementId): TranscriptResult {
    const key = forwardSourceKey(project, elementId)
    const words = key ? this.#bySource.get(key) : undefined
    if (!words || words.length === 0) {
      throw new CommandError(
        'invalid-payload',
        `no stored transcript for the audio "${elementId}" plays. Call find_retakes with elementId before cutting, or pass transcript.`,
      )
    }
    return { text: words.map((word) => word.text).join(' '), words, segments: [] }
  }
}
