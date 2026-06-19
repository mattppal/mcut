import {
  EditorEngine,
  MIN_ELEMENT_DURATION_MS,
  createElementId,
  getElementLocation,
  type AnyCommand,
  type ElementId,
  type Project,
  type TimelineElement,
} from '@mcut/timeline'

type ClipElement = TimelineElement & { type: 'video' | 'audio' }

export interface SilenceCutTranscript {
  words: Array<{ startMs: number; endMs: number }>
}

export interface SilenceCutOptions {
  /** Word gaps shorter than this are speech rhythm, not silence. Default 600. */
  minGapMs?: number
  /** Breathing room kept on each side of a cut. Default 120. */
  paddingMs?: number
  /** Speech chunks shorter than this merge into the surrounding cut. Default 250. */
  minKeepMs?: number
  /** Also cut silence before the first and after the last word. Default true. */
  trimEnds?: boolean
}

/** A window of source-media time (same clock as the transcript). */
export interface SilenceWindow {
  startMs: number
  endMs: number
}

export interface SilenceCutPlan {
  /** The cuts, in source-media time, padding already applied. */
  silences: SilenceWindow[]
  /** Every command dispatched, in order; replayable on the input project. */
  commands: AnyCommand[]
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

  const location = getElementLocation(project, elementId as ElementId)
  if (!location) throw new Error(`no element "${elementId}" in project`)
  const element = location.element
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

  const words = transcript.words
    .filter((word) => word.endMs > windowStart && word.startMs < windowEnd)
    .sort((a, b) => a.startMs - b.startMs)
  if (words.length === 0) {
    throw new Error(
      `transcript has no words inside the element's source window ` +
        `(${windowStart}-${windowEnd}ms); refusing to remove silence without word timings`,
    )
  }

  const silences = findSilences(words, windowStart, windowEnd, {
    minGapMs,
    paddingMs,
    minKeepMs,
    trimEnds,
  })

  const engine = new EditorEngine({ project })
  const commands: AnyCommand[] = []
  const dispatch = (command: AnyCommand) => {
    engine.dispatch(command)
    commands.push(command)
  }
  const current = (): ClipElement => {
    const found = getElementLocation(engine.project, elementId as ElementId)
    if (!found || (found.element.type !== 'video' && found.element.type !== 'audio')) {
      throw new Error(`element "${elementId}" disappeared mid-plan`)
    }
    return found.element
  }

  for (const silence of [...silences].reverse()) {
    const el = current()
    const toTimeline = (sourceMs: number) => el.startMs + (sourceMs - el.trimStartMs)
    if (silence.endMs >= windowEnd) {
      dispatch({
        type: 'trimElement',
        elementId,
        durationMs: toTimeline(silence.startMs) - el.startMs,
      })
    } else if (silence.startMs <= windowStart) {
      const rightElementId = createElementId()
      dispatch({
        type: 'splitElement',
        elementId,
        atMs: toTimeline(silence.endMs),
        rightElementId,
      })
      dispatch({ type: 'rippleDelete', elementIds: [elementId as ElementId] })
    } else {
      dispatch({
        type: 'splitElement',
        elementId,
        atMs: toTimeline(silence.endMs),
        rightElementId: createElementId(),
      })
      const middleElementId = createElementId()
      dispatch({
        type: 'splitElement',
        elementId,
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
  words: Array<{ startMs: number; endMs: number }>,
  windowStart: number,
  windowEnd: number,
  { minGapMs, paddingMs, minKeepMs, trimEnds }: FindOptions,
): SilenceWindow[] {
  const raw: SilenceWindow[] = []

  const first = words[0]!
  if (trimEnds && first.startMs - windowStart > minGapMs) {
    raw.push({ startMs: windowStart, endMs: first.startMs - paddingMs })
  }
  for (let i = 0; i < words.length - 1; i++) {
    const gapStart = words[i]!.endMs
    const gapEnd = words[i + 1]!.startMs
    if (gapEnd - gapStart > minGapMs) {
      raw.push({ startMs: gapStart + paddingMs, endMs: gapEnd - paddingMs })
    }
  }
  const last = words[words.length - 1]!
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
