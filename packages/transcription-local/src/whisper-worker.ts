import { pipeline } from '@huggingface/transformers'
import type { TranscriptResult, TranscriptSegment } from '@mcut/transcription'
import { mergeChunkSegments, planChunks, type ChunkSegmentResult } from './chunking'
import { textHasRepetitionLoop } from './repetition'
import { hasSpeech } from './vad'
import { WHISPER_SAMPLE_RATE } from './wav'
import type { WhisperDtype, WhisperWorkerRequest, WhisperWorkerResponse } from './protocol'

interface WorkerScope {
  postMessage(message: WhisperWorkerResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WhisperWorkerRequest>) => void) | null
}

const scope = globalThis as unknown as WorkerScope

type AsrPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> }>

let asrKey: string | null = null
let asrPromise: Promise<AsrPipeline> | null = null

function ensurePipeline(model: string, device: 'webgpu' | 'wasm', dtype: WhisperDtype, onProgress: (progress: number) => void): Promise<AsrPipeline> {
  const key = `${model}|${device}|${dtype}`
  if (asrKey !== key || !asrPromise) {
    asrKey = key
    asrPromise = pipeline('automatic-speech-recognition', model, {
      device,
      dtype,
      progress_callback: (event: { status?: string; progress?: number }) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          onProgress(event.progress / 100)
        }
      },
    }) as unknown as Promise<AsrPipeline>
  }
  return asrPromise
}

function isEnglishOnlyWhisperModel(model: string): boolean {
  // English-only Whisper checkpoints reject a language/task pair. https://github.com/openai/whisper#available-models-and-languages
  return model.endsWith('.en')
}

function whisperLanguageTaskOptions(multilingual: boolean, language: string | undefined): { task?: string; language?: string } {
  if (!multilingual) return {}
  return { task: 'transcribe', ...(language ? { language } : {}) }
}

async function transcribeWindow(
  asr: AsrPipeline,
  audio: Float32Array,
  multilingual: boolean,
  language: string | undefined,
): Promise<Array<{ text: string; timestamp: [number | null, number | null] }> | null> {
  const baseOptions: Record<string, unknown> = {
    // onnx-community Whisper builds need a _timestamped export for word-level return_timestamps. https://huggingface.co/onnx-community/whisper-medium.en_timestamped
    return_timestamps: true,
    ...whisperLanguageTaskOptions(multilingual, language),
  }
  for (const temperature of [0, 0.2, 0.4]) {
    const output = await asr(audio, {
      ...baseOptions,
      ...(temperature > 0 ? { temperature, do_sample: true } : {}),
    })
    if (!textHasRepetitionLoop(output.text)) {
      return output.chunks ?? [{ text: output.text, timestamp: [0, audio.length / WHISPER_SAMPLE_RATE] }]
    }
  }
  return null
}

async function handleTranscribe(message: WhisperWorkerRequest): Promise<TranscriptResult> {
  const { audio, config, language } = message
  const multilingual = !isEnglishOnlyWhisperModel(config.model)
  const asr = await ensurePipeline(config.model, config.device, config.dtype, (progress) =>
    scope.postMessage({ type: 'progress', id: message.id, progress, phase: 'model' }),
  )

  const durationS = audio.length / WHISPER_SAMPLE_RATE
  const chunks = planChunks(durationS)
  const results: ChunkSegmentResult[] = []
  for (const [index, chunk] of chunks.entries()) {
    const window = audio.subarray(Math.floor(chunk.startS * WHISPER_SAMPLE_RATE), Math.floor(chunk.endS * WHISPER_SAMPLE_RATE))
    if (hasSpeech(window, WHISPER_SAMPLE_RATE)) {
      const raw = await transcribeWindow(asr, window, multilingual, language)
      if (raw) {
        const offsetMs = chunk.startS * 1000
        const segments: TranscriptSegment[] = []
        for (const piece of raw) {
          const text = piece.text.trim()
          if (!text) continue
          const [startS, endS] = piece.timestamp
          const startMs = Math.round(offsetMs + (startS ?? 0) * 1000)
          const endMs = endS !== null ? Math.round(offsetMs + endS * 1000) : startMs + 1000
          segments.push({ text, startMs, endMs: Math.max(startMs, endMs) })
        }
        results.push({ chunk, segments })
      }
    }
    scope.postMessage({
      type: 'progress',
      id: message.id,
      progress: (index + 1) / chunks.length,
      phase: 'transcribe',
    })
  }

  const segments = mergeChunkSegments(results)
  return {
    text: segments.map((s) => s.text).join(' '),
    ...(language ? { language } : {}),
    durationMs: Math.round(durationS * 1000),
    words: [],
    segments,
  }
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type !== 'transcribe') return
  void handleTranscribe(message)
    .then((result) => scope.postMessage({ type: 'result', id: message.id, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
}

scope.postMessage({ type: 'ready' })
