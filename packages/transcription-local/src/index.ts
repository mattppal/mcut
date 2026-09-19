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

export const WHISPER_MODELS = {
  base: 'onnx-community/whisper-base',
  'tiny.en': 'onnx-community/whisper-tiny.en',
} as const

const MIN_DEVICE_MEMORY_GIB = 4
const ROOMY_DEVICE_MEMORY_GIB = 8

interface NavigatorCapabilities {
  gpu?: unknown
  deviceMemory?: number
}

function capabilities(): NavigatorCapabilities {
  return typeof navigator === 'undefined' ? {} : (navigator as unknown as NavigatorCapabilities)
}

export function isLocalTranscriptionSupported(): boolean {
  if (typeof Worker === 'undefined') return false
  const { gpu, deviceMemory } = capabilities()
  if (!gpu) return false
  // Safari and Firefox omit deviceMemory. https://www.w3.org/TR/device-memory-1/
  return deviceMemory === undefined || deviceMemory >= MIN_DEVICE_MEMORY_GIB
}

export function pickDefaultModel(): string {
  const { deviceMemory } = capabilities()
  return deviceMemory !== undefined && deviceMemory < ROOMY_DEVICE_MEMORY_GIB
    ? WHISPER_MODELS['tiny.en']
    : WHISPER_MODELS.base
}

export interface LocalWhisperProgress {
  phase: 'model' | 'transcribe'
  progress: number
}

export interface CreateLocalWhisperProviderOptions {
  model?: keyof typeof WHISPER_MODELS | (string & {})
  device?: 'webgpu' | 'wasm'
  dtype?: WhisperDtype
  onProgress?: (progress: LocalWhisperProgress) => void
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

  let reusedWorker: Worker | null = null
  let requestId = 0

  const ensureWorker = (): Worker => {
    reusedWorker ??= options.createWorker
      ? options.createWorker()
      : new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' })
    return reusedWorker
  }

  const terminateWorkerOnAbort = (target: Worker): void => {
    target.terminate()
    reusedWorker = null
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
          terminateWorkerOnAbort(target)
          reject(signal?.reason ?? new DOMException('Transcription aborted', 'AbortError'))
        }
        const onError = (event: ErrorEvent) => {
          cleanup()
          reusedWorker = null
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

async function decodeToWhisperInput(input: TranscribeInput): Promise<Float32Array> {
  const buffer = await toArrayBuffer(input.audio)
  const wav = parseWav(buffer)
  if (wav) return resampleTo(wav, WHISPER_SAMPLE_RATE)
  if (typeof AudioContext !== 'undefined') return decodeCompressedAudioOnMainThread(buffer)
  throw new Error('Unsupported audio: expected WAV (use extractAudioToWav) or a browser context')
}

async function decodeCompressedAudioOnMainThread(buffer: ArrayBuffer): Promise<Float32Array> {
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
