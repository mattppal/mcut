import type {
  TranscribeInput,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptResult,
} from '@mcut/transcription'
import type { WhisperDtype, WhisperWorkerRequest, WhisperWorkerResponse } from './protocol'
import { parseWav, resampleTo, WHISPER_SAMPLE_RATE } from './wav'

export {
  mergeChunkSegments,
  mergeChunkWords,
  planChunks,
  CHUNK_OVERLAP_S,
  CHUNK_WINDOW_S,
  type AudioChunk,
  type ChunkResult,
  type ChunkSegmentResult,
} from './chunking'
export { hasRepetitionLoop, textHasRepetitionLoop, type RepetitionOptions } from './repetition'
export { hasSpeech, measureActivity, type SpeechActivity } from './vad'
export { parseWav, resampleTo, WHISPER_SAMPLE_RATE, type DecodedAudio } from './wav'
export type {
  WhisperDtype,
  WhisperWorkerConfig,
  WhisperWorkerRequest,
  WhisperWorkerResponse,
} from './protocol'

/**
 * On-device Whisper provider (Transformers.js in a dedicated worker).
 * Reliability over flash: capability-gated hard (WebGPU + enough memory),
 * chunked with per-window progress, VAD + repetition guards in the worker.
 * On-device is OFFERED, never forced — keep a server provider as the
 * default and let users opt in (the model is a 40–150MB one-time download,
 * cached by the browser after that).
 */

/** Built-in model choices (ONNX community builds of OpenAI Whisper). */
export const WHISPER_MODELS = {
  /** Multilingual, ~145MB at q8 — the WebGPU default. */
  base: 'onnx-community/whisper-base',
  /** English-only, ~40MB — the low-memory default. */
  'tiny.en': 'onnx-community/whisper-tiny.en',
} as const

interface NavigatorCapabilities {
  gpu?: unknown
  deviceMemory?: number
}

function capabilities(): NavigatorCapabilities {
  return typeof navigator === 'undefined' ? {} : (navigator as unknown as NavigatorCapabilities)
}

/**
 * Hard capability gate: WebGPU plus ≥4GB device memory. Browsers that don't
 * report `deviceMemory` (Safari/Firefox) pass on WebGPU alone — the spec
 * caps reported values at 8 anyway.
 */
export function isLocalTranscriptionSupported(): boolean {
  if (typeof Worker === 'undefined') return false
  const { gpu, deviceMemory } = capabilities()
  if (!gpu) return false
  return deviceMemory === undefined || deviceMemory >= 4
}

/** whisper-base on roomy machines, whisper-tiny.en when memory is tight. */
export function pickDefaultModel(): string {
  const { deviceMemory } = capabilities()
  return deviceMemory !== undefined && deviceMemory < 8
    ? WHISPER_MODELS['tiny.en']
    : WHISPER_MODELS.base
}

export interface LocalWhisperProgress {
  /** 'model' while downloading/loading weights, then 'transcribe'. */
  phase: 'model' | 'transcribe'
  /** 0–1 within the phase. */
  progress: number
}

export interface CreateLocalWhisperProviderOptions {
  /** A {@link WHISPER_MODELS} key or any HF ASR model id. Default {@link pickDefaultModel}. */
  model?: keyof typeof WHISPER_MODELS | (string & {})
  /** Inference device. Default 'webgpu'. */
  device?: 'webgpu' | 'wasm'
  /** Quantization. Default 'q8'. */
  dtype?: WhisperDtype
  /** Model download + transcription progress. */
  onProgress?: (progress: LocalWhisperProgress) => void
  /** Override worker creation (custom bundling setups). */
  createWorker?: () => Worker
  id?: string
}

export function createLocalWhisperProvider(
  options: CreateLocalWhisperProviderOptions = {},
): TranscriptionProvider {
  const model =
    options.model && options.model in WHISPER_MODELS
      ? WHISPER_MODELS[options.model as keyof typeof WHISPER_MODELS]
      : (options.model ?? pickDefaultModel())
  const device = options.device ?? 'webgpu'
  const dtype = options.dtype ?? 'q8'

  // One worker per provider: the loaded model survives across calls.
  let worker: Worker | null = null
  let requestId = 0

  const ensureWorker = (): Worker => {
    worker ??= options.createWorker
      ? options.createWorker()
      : new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' })
    return worker
  }

  return {
    id: options.id ?? 'whisper-local',
    async transcribe(
      input: TranscribeInput,
      transcribeOptions?: TranscribeOptions,
    ): Promise<TranscriptResult> {
      const signal = transcribeOptions?.signal
      signal?.throwIfAborted()
      const audio = await decodeToWhisperInput(input)
      signal?.throwIfAborted()

      const target = ensureWorker()
      const id = requestId++
      return new Promise<TranscriptResult>((resolve, reject) => {
        const cleanup = () => {
          target.removeEventListener('message', onMessage)
          target.removeEventListener('error', onError)
          signal?.removeEventListener('abort', onAbort)
        }
        const onAbort = () => {
          cleanup()
          // Mid-inference there is no in-band cancel: drop the worker (the
          // model cache makes the next spin-up cheap).
          target.terminate()
          worker = null
          reject(signal?.reason ?? new DOMException('Transcription aborted', 'AbortError'))
        }
        const onError = (event: ErrorEvent) => {
          cleanup()
          worker = null
          reject(event.error instanceof Error ? event.error : new Error(event.message || 'Whisper worker crashed'))
        }
        const onMessage = (event: MessageEvent<WhisperWorkerResponse>) => {
          const message = event.data
          if (message.type === 'progress' && message.id === id) {
            options.onProgress?.({ phase: message.phase, progress: message.progress })
          } else if (message.type === 'result' && message.id === id) {
            cleanup()
            resolve(message.result)
          } else if (message.type === 'error' && message.id === id) {
            cleanup()
            reject(new Error(message.message))
          }
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        target.addEventListener('message', onMessage)
        target.addEventListener('error', onError)
        const request: WhisperWorkerRequest = {
          type: 'transcribe',
          id,
          config: { model, device, dtype },
          audio,
          ...(transcribeOptions?.language ? { language: transcribeOptions.language } : {}),
        }
        target.postMessage(request, [audio.buffer])
      })
    },
  }
}

/** Normalize any {@link TranscribeInput} into 16kHz mono PCM. */
async function decodeToWhisperInput(input: TranscribeInput): Promise<Float32Array> {
  const buffer = await toArrayBuffer(input.audio)
  const wav = parseWav(buffer)
  if (wav) return resampleTo(wav, WHISPER_SAMPLE_RATE)

  // Compressed audio: lean on the browser decoder (main-thread only).
  if (typeof AudioContext !== 'undefined') {
    const context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE })
    try {
      const decoded = await context.decodeAudioData(buffer.slice(0))
      const mono = new Float32Array(decoded.length)
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const channel = decoded.getChannelData(c)
        for (let i = 0; i < channel.length; i++) mono[i]! += channel[i]! / decoded.numberOfChannels
      }
      return resampleTo({ samples: mono, sampleRate: decoded.sampleRate }, WHISPER_SAMPLE_RATE)
    } finally {
      void context.close()
    }
  }
  throw new Error('Unsupported audio: expected WAV (use extractAudioToWav) or a browser context')
}

async function toArrayBuffer(audio: TranscribeInput['audio']): Promise<ArrayBuffer> {
  if (typeof audio === 'string') {
    const response = await fetch(audio)
    if (!response.ok) throw new Error(`Could not fetch audio (${response.status})`)
    return response.arrayBuffer()
  }
  if (audio instanceof Blob) return audio.arrayBuffer()
  if (audio instanceof ArrayBuffer) return audio
  const copy = new Uint8Array(audio.byteLength)
  copy.set(audio)
  return copy.buffer
}
