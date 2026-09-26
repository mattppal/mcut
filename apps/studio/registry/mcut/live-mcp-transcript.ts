'use client'

import { extractAudioToWav } from '@mcut/media'
import { buildApplyCaptionsCommand, type TranscribeOptions, type TranscriptResult } from '@mcut/transcription'
import {
  getProjectCaptions,
  getProjectTranscript,
  rangesOverlap,
  type EditorEngine,
  type ElementAudioSource,
  type ProjectTranscriptContext,
  resolveElementAudioSource,
} from '@mcut/timeline'
import type { MCP_TOOL_INPUTS } from '@mcut/mcp-server/contract'
import type { z } from 'zod'
import { isLocalTranscriptionSupported, transcribeOnDevice } from './local-transcription'

type EnsureTranscriptPayload = z.infer<typeof MCP_TOOL_INPUTS.ensure_transcript>

export interface EnsureTranscriptDeps {
  isLocalTranscriptionSupported: () => boolean
  extractAudioToWav: (src: string, signal: AbortSignal) => Promise<Blob | null>
  transcribeOnDevice: (audio: Blob, options?: TranscribeOptions) => Promise<TranscriptResult>
  audioExtractTimeoutMs?: number
}

export interface EnsureTranscriptResult {
  applied: boolean
  reason?: string
  source: {
    elementId: string
    assetId: string
    assetName?: string
    startMs: number
    endMs: number
    sourceStartMs: number
    sourceEndMs: number
  }
  transcript: ProjectTranscriptContext
}

const browserDeps: EnsureTranscriptDeps = {
  isLocalTranscriptionSupported,
  extractAudioToWav: (src, signal) => extractAudioToWav(src, { signal }),
  transcribeOnDevice,
}

const MIN_AUDIO_EXTRACT_TIMEOUT_MS = 30_000
const AUDIO_EXTRACT_MS_PER_SOURCE_MS = 0.1

async function extractSourceAudio(source: ElementAudioSource, deps: EnsureTranscriptDeps): Promise<Blob | null> {
  const timeoutMs = deps.audioExtractTimeoutMs ?? Math.max(MIN_AUDIO_EXTRACT_TIMEOUT_MS, (source.asset.durationMs ?? 0) * AUDIO_EXTRACT_MS_PER_SOURCE_MS)
  const controller = new AbortController()
  const timedOut = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
  })
  const timer = setTimeout(() => {
    controller.abort(
      new Error(
        `Timed out decoding the audio of "${source.asset.name ?? source.asset.id}" after ${Math.round(timeoutMs / 1000)}s, before transcription started. ` +
          'The Studio window may be too busy to decode it. Pause heavy previews and try again.',
      ),
    )
  }, timeoutMs)
  try {
    return await Promise.race([deps.extractAudioToWav(source.asset.src, controller.signal), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

function pickTranscriptionSource(engine: EditorEngine, payload: EnsureTranscriptPayload): ElementAudioSource {
  const project = engine.project
  if (payload.elementId) {
    const source = resolveElementAudioSource(project, payload.elementId)
    if (!source) throw new Error(`Element "${payload.elementId}" has no source audio.`)
    return source
  }

  for (const elementId of engine.selection.elementIds) {
    const source = resolveElementAudioSource(project, elementId)
    if (source) return source
  }

  const source = project.tracks
    .flatMap((track) => track.elements)
    .sort((a, b) => a.startMs - b.startMs)
    .map((element) => resolveElementAudioSource(project, element.id))
    .find((candidate): candidate is ElementAudioSource => candidate !== null)
  if (!source) throw new Error('Add a video, audio, or multicam clip with source audio to the timeline first.')
  return source
}

function assertBridgeTranscriptionSupported(source: ElementAudioSource): void {
  if (source.reversed) {
    throw new Error('Bridge transcription does not support reversed clips yet.')
  }
  if (source.timeMap) {
    throw new Error('Bridge transcription does not support speed-ramped clips yet.')
  }
}

function overlappingCaptions(engine: EditorEngine, source: ElementAudioSource) {
  return getProjectCaptions(engine.project).filter(({ caption }) =>
    rangesOverlap(caption.startMs, caption.durationMs, source.timelineStartMs, source.timelineDurationMs),
  )
}

function sourceResult(source: ElementAudioSource): EnsureTranscriptResult['source'] {
  return {
    elementId: source.elementId,
    assetId: source.asset.id,
    ...(source.asset.name ? { assetName: source.asset.name } : {}),
    startMs: source.timelineStartMs,
    endMs: source.timelineStartMs + source.timelineDurationMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
  }
}

async function transcribeSource(source: ElementAudioSource, language: string | undefined, deps: EnsureTranscriptDeps): Promise<TranscriptResult> {
  const wav = await extractSourceAudio(source, deps)
  if (!wav) {
    throw new Error(`"${source.asset.name ?? source.asset.id}" has no audio track.`)
  }
  return deps.transcribeOnDevice(wav, language ? { language } : undefined)
}

const inFlight = new WeakMap<EnsureTranscriptDeps, Map<string, Promise<TranscriptResult>>>()

function sharedTranscription(source: ElementAudioSource, language: string | undefined, deps: EnsureTranscriptDeps): Promise<TranscriptResult> {
  const key = `${source.asset.id}|${source.sourceStartMs}|${source.sourceEndMs}|${language ?? ''}`
  let running = inFlight.get(deps)
  if (!running) {
    running = new Map()
    inFlight.set(deps, running)
  }
  const pending = running.get(key)
  if (pending) return pending
  const started = transcribeSource(source, language, deps).finally(() => running.delete(key))
  running.set(key, started)
  return started
}

export async function ensureTranscriptForBridge(
  engine: EditorEngine,
  payload: EnsureTranscriptPayload,
  deps: EnsureTranscriptDeps = browserDeps,
): Promise<EnsureTranscriptResult> {
  const source = pickTranscriptionSource(engine, payload)
  const sourceInfo = sourceResult(source)
  const existingTranscript = (): EnsureTranscriptResult | null =>
    !payload.replace && overlappingCaptions(engine, source).length > 0
      ? {
          applied: false,
          reason: 'Transcript captions already overlap the target clip.',
          source: sourceInfo,
          transcript: getProjectTranscript(engine.project, { includeWords: true }),
        }
      : null

  const before = existingTranscript()
  if (before) return before

  assertBridgeTranscriptionSupported(source)
  if (!deps.isLocalTranscriptionSupported()) {
    throw new Error('Local Whisper transcription is not supported in this browser. Use a WebGPU-capable browser with enough memory.')
  }

  const result = await sharedTranscription(source, payload.language, deps)
  const meanwhile = existingTranscript()
  if (meanwhile) return meanwhile
  const command = buildApplyCaptionsCommand(result, {
    replace: false,
    timeOffsetMs: source.timelineStartMs,
    sourceStartMs: source.sourceStartMs,
    sourceEndMs: source.sourceEndMs,
  })
  if (!Array.isArray(command.captions) || command.captions.length === 0) {
    throw new Error('Transcription produced no captions for the target clip.')
  }

  engine.transact(() => {
    if (payload.replace) {
      for (const { caption } of overlappingCaptions(engine, source)) {
        engine.dispatch({ type: 'removeElement', elementId: caption.id })
      }
    }
    engine.dispatch(command)
  })

  return {
    applied: true,
    source: sourceInfo,
    transcript: getProjectTranscript(engine.project, { includeWords: true }),
  }
}
