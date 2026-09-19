import { z } from 'zod'
import {
  EditorEngine,
  MIN_ELEMENT_DURATION_MS,
  createElementId,
  elementIdSchema,
  getElementLocation,
  type BuiltinCommand,
  type Project,
  type TimelineElement,
} from '@mcut/timeline'

type ClipElement = TimelineElement & { type: 'video' | 'audio' }

interface WordTiming {
  startMs: number
  endMs: number
}

export interface SilenceCutTranscript {
  words: Array<{ startMs: number; endMs: number }>
}

export const silenceCutOptionsSchema = z.object({
  minGapMs: z
    .number()
    .nonnegative()
    .optional()
    .describe('Word gaps shorter than this are speech rhythm, not silence. Default 600.'),
  paddingMs: z
    .number()
    .nonnegative()
    .optional()
    .describe('Breathing room kept on each side of a cut. Default 120.'),
  minKeepMs: z
    .number()
    .nonnegative()
    .optional()
    .describe('Speech chunks shorter than this merge into the surrounding cut. Default 250.'),
  trimEnds: z
    .boolean()
    .optional()
    .describe('Also cut silence before the first and after the last word. Default true.'),
})

export type SilenceCutOptions = z.infer<typeof silenceCutOptionsSchema>

/** A window of source-media time (same clock as the transcript). */
export interface SilenceWindow {
  startMs: number
  endMs: number
}

export interface SilenceCutPlan {
  /** The cuts, in source-media time, padding already applied. */
  silences: SilenceWindow[]
  /** Every command dispatched, in order; replayable on the input project. */
  commands: BuiltinCommand[]
  removedMs: number
  /** The project with all cuts applied. */
  project: Project
}

/**
 * Plan and apply silence cuts on one video/audio element from transcript word timings.
 *
 * Word timings are source-media times, so the element must play at 1x (no
 * timeMap). Interior and leading silences become split + rippleDelete; trailing
 * silence becomes a trim. Cuts are applied last-to-first so earlier timeline
 * positions stay valid throughout.
 */
export function planSilenceCuts(
  project: Project,
  elementId: string,
  transcript: SilenceCutTranscript,
  options: SilenceCutOptions = {},
): SilenceCutPlan {
  const minGapMs = options.minGapMs ?? 600
  const paddingMs = options.paddingMs ?? 120
  const minKeepMs = Math.max(options.minKeepMs ?? 250, MIN_ELEMENT_DURATION_MS)
  const trimEnds = options.trimEnds ?? true

  const parsedId = elementIdSchema.safeParse(elementId)
  const location = parsedId.success ? getElementLocation(project, parsedId.data) : undefined
  if (!location) throw new Error(`no element "${elementId}" in project`)
  const element = location.element
  const id = element.id
  if (element.type !== 'video' && element.type !== 'audio') {
    throw new Error(`silence cuts apply to video/audio elements, not "${element.type}"`)
  }
  if (element.timeMap) {
    throw new Error(
      `element "${elementId}" has a time remap; silence cuts require 1x playback ` +
        '(clear it with setTimeMap null first)',
    )
  }

  const windowStart = element.trimStartMs
  const windowEnd = element.trimStartMs + element.durationMs

  const [firstWord, ...restWords] = transcript.words
    .filter((word) => word.endMs > windowStart && word.startMs < windowEnd)
    .sort((a, b) => a.startMs - b.startMs)
  if (!firstWord) {
    throw new Error(
      `transcript has no words inside the element's source window ` +
        `(${windowStart}-${windowEnd}ms); refusing to remove silence without word timings`,
    )
  }

  const silences = findSilences([firstWord, ...restWords], windowStart, windowEnd, {
    minGapMs,
    paddingMs,
    minKeepMs,
    trimEnds,
  })

  const engine = new EditorEngine({ project })
  const commands: BuiltinCommand[] = []
  const dispatch = (command: BuiltinCommand) => {
    engine.dispatch(command)
    commands.push(command)
  }
  const current = (): ClipElement => {
    const found = getElementLocation(engine.project, id)
    if (!found || (found.element.type !== 'video' && found.element.type !== 'audio')) {
      throw new Error(`element "${id}" disappeared mid-plan`)
    }
    return found.element
  }

  for (const silence of [...silences].reverse()) {
    const el = current()
    const toTimeline = (sourceMs: number) => el.startMs + (sourceMs - el.trimStartMs)
    if (silence.endMs >= windowEnd) {
      dispatch({
        type: 'trimElement',
        elementId: id,
        durationMs: toTimeline(silence.startMs) - el.startMs,
      })
    } else if (silence.startMs <= windowStart) {
      const rightElementId = createElementId()
      dispatch({
        type: 'splitElement',
        elementId: id,
        atMs: toTimeline(silence.endMs),
        rightElementId,
      })
      dispatch({ type: 'rippleDelete', elementIds: [id] })
    } else {
      dispatch({
        type: 'splitElement',
        elementId: id,
        atMs: toTimeline(silence.endMs),
        rightElementId: createElementId(),
      })
      const middleElementId = createElementId()
      dispatch({
        type: 'splitElement',
        elementId: id,
        atMs: toTimeline(silence.startMs),
        rightElementId: middleElementId,
      })
      dispatch({ type: 'rippleDelete', elementIds: [middleElementId] })
    }
  }

  return {
    silences,
    commands,
    removedMs: silences.reduce((sum, s) => sum + (s.endMs - s.startMs), 0),
    project: engine.project,
  }
}

interface FindOptions {
  minGapMs: number
  paddingMs: number
  minKeepMs: number
  trimEnds: boolean
}

function findSilences(
  words: readonly [WordTiming, ...WordTiming[]],
  windowStart: number,
  windowEnd: number,
  { minGapMs, paddingMs, minKeepMs, trimEnds }: FindOptions,
): SilenceWindow[] {
  const raw: SilenceWindow[] = []

  const [first, ...rest] = words
  if (trimEnds && first.startMs - windowStart > minGapMs) {
    raw.push({ startMs: windowStart, endMs: first.startMs - paddingMs })
  }
  let last = first
  for (const word of rest) {
    const gapStart = last.endMs
    const gapEnd = word.startMs
    if (gapEnd - gapStart > minGapMs) {
      raw.push({ startMs: gapStart + paddingMs, endMs: gapEnd - paddingMs })
    }
    last = word
  }
  if (trimEnds && windowEnd - last.endMs > minGapMs) {
    raw.push({ startMs: last.endMs + paddingMs, endMs: windowEnd })
  }

  const clamped = raw
    .map((s) => ({
      startMs: Math.round(Math.max(s.startMs, windowStart)),
      endMs: Math.round(Math.min(s.endMs, windowEnd)),
    }))
    .filter((s) => s.endMs - s.startMs >= MIN_ELEMENT_DURATION_MS)

  const merged: SilenceWindow[] = []
  for (const silence of clamped) {
    const previous = merged[merged.length - 1]
    if (previous && silence.startMs - previous.endMs < minKeepMs) {
      previous.endMs = silence.endMs
    } else {
      merged.push({ ...silence })
    }
  }

  if (merged.some((s) => s.startMs <= windowStart && s.endMs >= windowEnd)) {
    throw new Error('silence cut would remove the entire element; check the transcript timing')
  }

  return merged
}
