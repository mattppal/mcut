import { planSilenceCuts } from '@mcut/editor'
import {
  elementIdSchema,
  getElementLocation,
  getProjectTranscript,
  isMediaClip,
  resolveElementAudioSource,
  type EditorEngine,
  type ElementAudioSource,
  type ElementId,
  type MediaClip,
  type ProjectTranscriptWordContext,
  type TimelineElement,
} from '@mcut/timeline'
import { z } from 'zod'

const silenceActionInputSchema = z.strictObject({
  elementId: elementIdSchema.optional(),
  minGapMs: z.number().min(0).optional(),
  paddingMs: z.number().min(0).optional(),
  minKeepMs: z.number().min(0).optional(),
  trimEnds: z.boolean().optional(),
})

const fadeActionInputSchema = z.strictObject({
  elementId: elementIdSchema.optional(),
  durationMs: z.number().min(10).optional(),
})

type VisualElement = TimelineElement & { type: 'video' | 'image' | 'text' | 'multicam' }

function parseActionInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value ?? {})
  if (parsed.success) return parsed.data
  throw new Error(z.prettifyError(parsed.error))
}

function isVisualElement(element: TimelineElement): element is VisualElement {
  return element.type === 'video' || element.type === 'image' || element.type === 'text' || element.type === 'multicam'
}

function pickElement<T extends TimelineElement>(
  engine: EditorEngine,
  explicitId: ElementId | undefined,
  predicate: (element: TimelineElement) => element is T,
  emptyMessage: string,
): T {
  if (explicitId) {
    const location = getElementLocation(engine.project, explicitId)
    if (!location || !predicate(location.element)) {
      throw new Error(`Element "${explicitId}" is not a supported target.`)
    }
    return location.element
  }

  for (const elementId of engine.selection.elementIds) {
    const location = getElementLocation(engine.project, elementId)
    if (location && predicate(location.element)) return location.element
  }

  for (const track of engine.project.tracks) {
    for (const element of track.elements) {
      if (predicate(element)) return element
    }
  }

  throw new Error(emptyMessage)
}

function silenceTarget(engine: EditorEngine, explicitId: ElementId | undefined): { element: MediaClip; source: ElementAudioSource } {
  if (explicitId) {
    const location = getElementLocation(engine.project, explicitId)
    if (!location || !isMediaClip(location.element)) throw new Error(`Element "${explicitId}" is not a supported target.`)
    const source = resolveElementAudioSource(engine.project, explicitId)
    if (!source) {
      if (location.element.type === 'multicam') throw new Error(`Element "${explicitId}" has no audio source. Set one with setMulticamAudio.`)
      throw new Error(`Element "${explicitId}" has no source audio.`)
    }
    return { element: location.element, source }
  }

  let resolved: { element: MediaClip; source: ElementAudioSource } | undefined
  for (const elementId of engine.selection.elementIds) {
    const location = getElementLocation(engine.project, elementId)
    if (!location || !isMediaClip(location.element)) continue
    const source = resolveElementAudioSource(engine.project, elementId)
    if (!source) {
      if (location.element.type === 'multicam') throw new Error(`Element "${elementId}" has no audio source. Set one with setMulticamAudio.`)
      continue
    }
    if (!resolved) resolved = { element: location.element, source }
  }
  if (resolved) return resolved

  for (const track of engine.project.tracks) {
    for (const element of track.elements) {
      if (!isMediaClip(element)) continue
      const source = resolveElementAudioSource(engine.project, element.id)
      if (source) return { element, source }
    }
  }
  throw new Error('Add or select a clip with source audio before removing silence.')
}

function transcriptWordsForElement(
  engine: EditorEngine,
  source: ElementAudioSource,
): Array<ProjectTranscriptWordContext & { sourceStartMs: number; sourceEndMs: number }> {
  if (source.timeMap) throw new Error('Transcript silence removal requires a 1x clip with no time remap.')
  if (source.reversed) throw new Error('Transcript silence removal requires forward playback.')

  const startMs = source.timelineStartMs
  const endMs = startMs + source.timelineDurationMs
  return getProjectTranscript(engine.project, { includeWords: true })
    .captions.flatMap((caption) => caption.words ?? [])
    .filter((word) => word.endMs > startMs && word.startMs < endMs)
    .map((word) => ({
      ...word,
      sourceStartMs: source.sourceStartMs + (word.startMs - startMs),
      sourceEndMs: source.sourceStartMs + (word.endMs - startMs),
    }))
}

export function silenceRemovalEnabled(engine: EditorEngine): boolean {
  return engine.project.tracks.some((track) =>
    track.elements.some((element) => isMediaClip(element) && resolveElementAudioSource(engine.project, element.id) !== null),
  )
}

export function removeTranscriptSilence(engine: EditorEngine, value: unknown): unknown {
  const input = parseActionInput(silenceActionInputSchema, value)
  const { element, source } = silenceTarget(engine, input.elementId)
  const words = transcriptWordsForElement(engine, source)
  if (words.length === 0) {
    throw new Error('No word-timed transcript overlaps the target clip. Call ensure_transcript first.')
  }

  const plan = planSilenceCuts(
    engine.project,
    element.id,
    {
      words: words.map((word) => ({
        startMs: Math.round(word.sourceStartMs),
        endMs: Math.round(word.sourceEndMs),
      })),
    },
    {
      ...(input.minGapMs !== undefined ? { minGapMs: input.minGapMs } : {}),
      ...(input.paddingMs !== undefined ? { paddingMs: input.paddingMs } : {}),
      ...(input.minKeepMs !== undefined ? { minKeepMs: input.minKeepMs } : {}),
      ...(input.trimEnds !== undefined ? { trimEnds: input.trimEnds } : {}),
    },
  )

  if (plan.commands.length > 0) {
    engine.transact(() => {
      for (const command of plan.commands) engine.dispatch(command)
    })
  }

  return {
    elementId: element.id,
    applied: plan.commands.length,
    removedMs: plan.removedMs,
    silences: plan.silences,
  }
}

export function applyOpeningClosingFades(engine: EditorEngine, value: unknown): unknown {
  const input = parseActionInput(fadeActionInputSchema, value)
  const element = pickElement(engine, input.elementId, isVisualElement, 'Add or select a visual clip before applying opening/closing fades.')
  const durationMs = Math.max(10, Math.round(input.durationMs ?? 500))

  engine.transact(() => {
    engine.dispatch({
      type: 'applyAnimationPreset',
      elementId: element.id,
      preset: 'fade-in',
      options: { durationMs },
    })
    engine.dispatch({
      type: 'applyAnimationPreset',
      elementId: element.id,
      preset: 'fade-out',
      options: { durationMs },
    })
  })

  return {
    elementId: element.id,
    durationMs,
    presets: ['fade-in', 'fade-out'],
  }
}
