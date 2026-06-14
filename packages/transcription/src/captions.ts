import {
  MIN_ELEMENT_DURATION_MS,
  type AnyCommand,
  type CaptionStyle,
  type CaptionWord,
  type TrackId,
} from '@mcut/timeline'
import type { TranscriptResult, TranscriptWord } from './types'

export interface GroupWordsOptions {
  /** Soft maximum characters per caption line group. Default 36. */
  maxChars?: number
  /** Maximum duration of one caption. Default 5000ms. */
  maxDurationMs?: number
  /** A silence gap longer than this starts a new caption. Default 800ms. */
  maxGapMs?: number
}

export interface WordGroup {
  text: string
  startMs: number
  endMs: number
  words: TranscriptWord[]
}

/** Chunk word timings into caption-sized groups. */
export function groupWords(words: TranscriptWord[], options: GroupWordsOptions = {}): WordGroup[] {
  const maxChars = options.maxChars ?? 36
  const maxDurationMs = options.maxDurationMs ?? 5000
  const maxGapMs = options.maxGapMs ?? 800

  const groups: WordGroup[] = []
  let current: TranscriptWord[] = []
  let chars = 0

  const flush = () => {
    if (current.length === 0) return
    groups.push({
      text: current.map((w) => w.text).join(' '),
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
      words: current,
    })
    current = []
    chars = 0
  }

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1]!
      const wouldExceedChars = chars + 1 + word.text.length > maxChars
      const wouldExceedDuration = word.endMs - current[0]!.startMs > maxDurationMs
      const gapTooLong = word.startMs - previous.endMs > maxGapMs
      const speakerChanged = word.speaker !== previous.speaker
      if (wouldExceedChars || wouldExceedDuration || gapTooLong || speakerChanged) flush()
    }
    chars += (current.length > 0 ? 1 : 0) + word.text.length
    current.push(word)
  }
  flush()
  return groups
}

export interface CaptionElementInput {
  type: 'caption'
  startMs: number
  durationMs: number
  text: string
  words?: CaptionWord[]
  style?: Partial<CaptionStyle>
}

export interface ToCaptionElementsOptions extends GroupWordsOptions {
  style?: Partial<CaptionStyle>
  /**
   * Shift generated captions onto a timeline position. For example, a
   * transcript from a clip starting at 10s should use `timeOffsetMs: 10000`.
   */
  timeOffsetMs?: number
  /** Ignore transcript content before this source-media timestamp. */
  sourceStartMs?: number
  /** Ignore transcript content at or after this source-media timestamp. */
  sourceEndMs?: number
}

function normalizeRange(options: ToCaptionElementsOptions) {
  const sourceStartMs = Math.max(0, Math.round(options.sourceStartMs ?? 0))
  const sourceEndMs =
    options.sourceEndMs === undefined
      ? undefined
      : Math.max(sourceStartMs, Math.round(options.sourceEndMs))
  const timeOffsetMs = Math.max(0, Math.round(options.timeOffsetMs ?? 0))
  return { sourceStartMs, sourceEndMs, timeOffsetMs }
}

function mapSourceTimeToCaptionTime(
  valueMs: number,
  sourceStartMs: number,
  sourceEndMs: number | undefined,
  timeOffsetMs: number,
): number {
  const clampedToStart = Math.max(valueMs, sourceStartMs)
  const clamped = sourceEndMs === undefined ? clampedToStart : Math.min(clampedToStart, sourceEndMs)
  return clamped - sourceStartMs + timeOffsetMs
}

/**
 * Convert a transcript into caption elements ready for the `applyCaptions`
 * command: grouped to caption length, word timings made relative to each
 * element, overlaps clamped to satisfy the track invariant.
 */
export function toCaptionElements(
  result: TranscriptResult,
  options: ToCaptionElementsOptions = {},
): CaptionElementInput[] {
  const { sourceStartMs, sourceEndMs, timeOffsetMs } = normalizeRange(options)
  let groups: WordGroup[]
  if (result.words.length > 0) {
    const words = result.words
      .filter(
        (word) =>
          word.endMs > sourceStartMs &&
          (sourceEndMs === undefined || word.startMs < sourceEndMs),
      )
      .map((word) => ({
        ...word,
        startMs: mapSourceTimeToCaptionTime(
          word.startMs,
          sourceStartMs,
          sourceEndMs,
          timeOffsetMs,
        ),
        endMs: mapSourceTimeToCaptionTime(word.endMs, sourceStartMs, sourceEndMs, timeOffsetMs),
      }))
      .filter((word) => word.endMs > word.startMs)
    groups = groupWords(words, options)
  } else if (result.segments.length > 0) {
    groups = result.segments
      .filter(
        (segment) =>
          segment.endMs > sourceStartMs &&
          (sourceEndMs === undefined || segment.startMs < sourceEndMs),
      )
      .map((segment) => ({
        text: segment.text,
        startMs: mapSourceTimeToCaptionTime(
          segment.startMs,
          sourceStartMs,
          sourceEndMs,
          timeOffsetMs,
        ),
        endMs: mapSourceTimeToCaptionTime(
          segment.endMs,
          sourceStartMs,
          sourceEndMs,
          timeOffsetMs,
        ),
        words: [],
      }))
      .filter((segment) => segment.endMs > segment.startMs)
  } else if (result.text.trim().length > 0 && result.durationMs) {
    const endMs = sourceEndMs ?? result.durationMs
    if (endMs <= sourceStartMs) return []
    groups = [
      {
        text: result.text.trim(),
        startMs: timeOffsetMs,
        endMs: endMs - sourceStartMs + timeOffsetMs,
        words: [],
      },
    ]
  } else {
    return []
  }

  const elements: CaptionElementInput[] = []
  let previousEndMs = 0
  for (const group of groups) {
    const startMs = Math.max(Math.round(group.startMs), previousEndMs)
    const durationMs = Math.max(MIN_ELEMENT_DURATION_MS, Math.round(group.endMs) - startMs)
    previousEndMs = startMs + durationMs
    elements.push({
      type: 'caption',
      startMs,
      durationMs,
      text: group.text,
      ...(group.words.length > 0
        ? {
            words: group.words.map((w) => ({
              text: w.text,
              startMs: Math.max(0, Math.round(w.startMs) - startMs),
              endMs: Math.max(0, Math.round(w.endMs) - startMs),
            })),
          }
        : {}),
      ...(options.style ? { style: options.style } : {}),
    })
  }
  return elements
}

export interface BuildApplyCaptionsOptions extends ToCaptionElementsOptions {
  trackId?: TrackId
  /** Replace existing captions on the target track. Default true. */
  replace?: boolean
}

/** Build the `applyCaptions` command for {@link toCaptionElements} output. */
export function buildApplyCaptionsCommand(
  result: TranscriptResult,
  options: BuildApplyCaptionsOptions = {},
): AnyCommand {
  const { trackId, replace, ...rest } = options
  return {
    type: 'applyCaptions',
    captions: toCaptionElements(result, rest).map(({ type: _type, ...caption }) => caption),
    ...(trackId ? { trackId } : {}),
    ...(replace !== undefined ? { replace } : {}),
  }
}
