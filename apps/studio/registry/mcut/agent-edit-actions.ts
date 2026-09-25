import { planSilenceCuts } from '@mcut/editor'
import { exportProject, getExportSupport } from '@mcut/media'
import {
  elementIdSchema,
  getElementLocation,
  getProjectDurationMs,
  getProjectTranscript,
  type EditorEngine,
  type ElementId,
  type ProjectTranscriptWordContext,
  type TimelineElement,
} from '@mcut/timeline'
import { z } from 'zod'
import { downloadBlob } from './download-blob'
import { collectProjectFontExports, ensureProjectFontsLoaded } from './font-library'
import { voiceStems } from './voice-cleanup'

const exportActionInputSchema = z.strictObject({
  format: z.enum(['webm', 'mp4', 'mkv']).optional(),
  download: z.boolean().optional(),
})

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
type MediaElement = TimelineElement & { type: 'video' | 'audio' }

function parseActionInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value ?? {})
  if (parsed.success) return parsed.data
  throw new Error(z.prettifyError(parsed.error))
}

function isMediaElement(element: TimelineElement): element is MediaElement {
  return element.type === 'video' || element.type === 'audio'
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

function transcriptWordsForElement(
  engine: EditorEngine,
  element: MediaElement,
): Array<ProjectTranscriptWordContext & { sourceStartMs: number; sourceEndMs: number }> {
  if (element.timeMap) {
    throw new Error('Transcript silence removal requires a 1x clip with no time remap.')
  }

  const startMs = element.startMs
  const endMs = element.startMs + element.durationMs
  return getProjectTranscript(engine.project, { includeWords: true })
    .captions.flatMap((caption) => caption.words ?? [])
    .filter((word) => word.endMs > startMs && word.startMs < endMs)
    .map((word) => ({
      ...word,
      sourceStartMs: element.trimStartMs + (word.startMs - element.startMs),
      sourceEndMs: element.trimStartMs + (word.endMs - element.startMs),
    }))
}

export function removeTranscriptSilence(engine: EditorEngine, value: unknown): unknown {
  const input = parseActionInput(silenceActionInputSchema, value)
  const element = pickElement(engine, input.elementId, isMediaElement, 'Add or select a video/audio clip before removing silence.')
  const words = transcriptWordsForElement(engine, element)
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

export async function exportProjectVideo(engine: EditorEngine, value: unknown): Promise<unknown> {
  const input = parseActionInput(exportActionInputSchema, value)
  const format = input.format ?? 'webm'
  const durationMs = getProjectDurationMs(engine.project)
  if (durationMs <= 0) throw new Error('Place at least one clip on the timeline before exporting.')
  const support = await getExportSupport(format)
  if (!support.video) throw new Error(`This browser cannot encode ${format} video with WebCodecs.`)
  engine.pause()
  const audioSources = await voiceStems.ready(engine.project)
  await ensureProjectFontsLoaded(engine.project)
  const fonts = await collectProjectFontExports(engine.project)
  const startedAt = performance.now()
  const result = await exportProject(engine.project, { format, fonts, audioSources })
  const filename = `${engine.project.name || 'export'}.${result.extension}`
  if (input.download ?? true) downloadBlob(result.blob, filename)
  return {
    format,
    filename,
    mimeType: result.blob.type,
    bytes: result.blob.size,
    durationMs,
    audio: support.audio,
    renderMs: Math.round(performance.now() - startedAt),
  }
}
