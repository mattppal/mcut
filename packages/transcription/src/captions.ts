import { z } from 'zod'
import {
  CAPTION_STYLE_PRESETS,
  MIN_ELEMENT_DURATION_MS,
  elementIdSchema,
  getElementLocation,
  type CommandOfType,
  type CaptionStyle,
  type CaptionWord,
  type Project,
  type TrackId,
} from '@mcut/timeline'
import type { TranscriptResult, TranscriptWord } from './types'

const DEFAULT_CAPTION_MAX_CHARS = 36
const DEFAULT_CAPTION_MAX_DURATION_MS = 5000
const DEFAULT_CAPTION_MAX_GAP_MS = 800

export interface GroupWordsOptions {
  maxChars?: number
  maxDurationMs?: number
  maxGapMs?: number
}

export interface WordGroup {
  text: string
  startMs: number
  endMs: number
  words: TranscriptWord[]
}

export function groupWords(words: TranscriptWord[], options: GroupWordsOptions = {}): WordGroup[] {
  const maxChars = options.maxChars ?? DEFAULT_CAPTION_MAX_CHARS
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_CAPTION_MAX_DURATION_MS
  const maxGapMs = options.maxGapMs ?? DEFAULT_CAPTION_MAX_GAP_MS

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
  timeOffsetMs?: number
  sourceStartMs?: number
  sourceEndMs?: number
}

function normalizeRange(options: ToCaptionElementsOptions) {
  const sourceStartMs = Math.max(0, Math.round(options.sourceStartMs ?? 0))
  const sourceEndMs = options.sourceEndMs === undefined ? undefined : Math.max(sourceStartMs, Math.round(options.sourceEndMs))
  const timeOffsetMs = Math.max(0, Math.round(options.timeOffsetMs ?? 0))
  return { sourceStartMs, sourceEndMs, timeOffsetMs }
}

function mapSourceTimeToCaptionTime(valueMs: number, sourceStartMs: number, sourceEndMs: number | undefined, timeOffsetMs: number): number {
  const clampedToStart = Math.max(valueMs, sourceStartMs)
  const clamped = sourceEndMs === undefined ? clampedToStart : Math.min(clampedToStart, sourceEndMs)
  return clamped - sourceStartMs + timeOffsetMs
}

export function toCaptionElements(result: TranscriptResult, options: ToCaptionElementsOptions = {}): CaptionElementInput[] {
  const { sourceStartMs, sourceEndMs, timeOffsetMs } = normalizeRange(options)
  let groups: WordGroup[]
  if (result.words.length > 0) {
    const words = result.words
      .filter((word) => word.endMs > sourceStartMs && (sourceEndMs === undefined || word.startMs < sourceEndMs))
      .map((word) => ({
        ...word,
        startMs: mapSourceTimeToCaptionTime(word.startMs, sourceStartMs, sourceEndMs, timeOffsetMs),
        endMs: mapSourceTimeToCaptionTime(word.endMs, sourceStartMs, sourceEndMs, timeOffsetMs),
      }))
      .filter((word) => word.endMs > word.startMs)
    groups = groupWords(words, options)
  } else if (result.segments.length > 0) {
    groups = result.segments
      .filter((segment) => segment.endMs > sourceStartMs && (sourceEndMs === undefined || segment.startMs < sourceEndMs))
      .map((segment) => ({
        text: segment.text,
        startMs: mapSourceTimeToCaptionTime(segment.startMs, sourceStartMs, sourceEndMs, timeOffsetMs),
        endMs: mapSourceTimeToCaptionTime(segment.endMs, sourceStartMs, sourceEndMs, timeOffsetMs),
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
  replace?: boolean
}

export function buildApplyCaptionsCommand(result: TranscriptResult, options: BuildApplyCaptionsOptions = {}): CommandOfType<'applyCaptions'> {
  const { trackId, replace, ...rest } = options
  return {
    type: 'applyCaptions',
    captions: toCaptionElements(result, rest).map(({ type: _type, ...caption }) => caption),
    ...(trackId ? { trackId } : {}),
    ...(replace !== undefined ? { replace } : {}),
  }
}

export const captionsCommandOptionsSchema = z.object({
  elementId: elementIdSchema
    .optional()
    .describe(
      'Scope the transcript to one video/audio element: caption only the source span the clip ' +
        'plays, positioned at its timeline location. Without it the transcript starts at timeline 0.',
    ),
  styleId: z.string().optional().describe('A preset id from CAPTION_STYLE_PRESETS (classic, karaoke, spotlight, ...).'),
  maxChars: z.number().int().positive().optional().describe('Soft maximum characters per caption. Default 36.'),
  maxGapMs: z.number().nonnegative().optional().describe('A silence gap longer than this starts a new caption. Default 800.'),
  replace: z.boolean().optional().describe('Clear existing captions on the target track first.'),
})

export type CaptionsCommandOptions = z.infer<typeof captionsCommandOptionsSchema>

function sourceWindowForClip(element: { startMs: number; trimStartMs: number; durationMs: number }): {
  timeOffsetMs: number
  sourceStartMs: number
  sourceEndMs: number
} {
  return {
    timeOffsetMs: element.startMs,
    sourceStartMs: element.trimStartMs,
    sourceEndMs: element.trimStartMs + element.durationMs,
  }
}

export function buildCaptionsCommand(project: Project, transcript: TranscriptResult, options: CaptionsCommandOptions = {}): CommandOfType<'applyCaptions'> {
  let style
  if (options.styleId) {
    const preset = CAPTION_STYLE_PRESETS.find((p) => p.id === options.styleId)
    if (!preset) {
      const known = CAPTION_STYLE_PRESETS.map((p) => p.id).join(', ')
      throw new Error(`unknown caption style "${options.styleId}" (known: ${known})`)
    }
    style = preset.style
  }

  let scope = {}
  if (options.elementId) {
    const location = getElementLocation(project, options.elementId)
    if (!location) throw new Error(`no element "${options.elementId}" in project`)
    const element = location.element
    if (element.type !== 'video' && element.type !== 'audio') {
      throw new Error(`captions scope to video/audio elements, not "${element.type}"`)
    }
    if (element.timeMap) {
      throw new Error(`element "${options.elementId}" has a time remap; transcript times will not line up`)
    }
    scope = sourceWindowForClip(element)
  }

  return buildApplyCaptionsCommand(transcript, {
    ...scope,
    ...(style ? { style } : {}),
    ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    ...(options.maxGapMs !== undefined ? { maxGapMs: options.maxGapMs } : {}),
    ...(options.replace !== undefined ? { replace: options.replace } : {}),
  })
}
