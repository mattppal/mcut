import { env, pipeline } from '@huggingface/transformers'
import type { TranscriptResult, TranscriptWord } from '@mcut/transcription'
import { mergeChunkWords, planChunks, segmentsFromWords, type ChunkResult } from './chunking'
import { textHasRepetitionLoop } from './repetition'
import { hasSpeech } from './vad'
import { WHISPER_SAMPLE_RATE } from './wav'
import type { WhisperWorkerConfig, WhisperWorkerRequest, WhisperWorkerResponse } from './protocol'

interface WorkerScope {
  postMessage(message: WhisperWorkerResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WhisperWorkerRequest>) => void) | null
}

const scope = globalThis as unknown as WorkerScope

interface AsrChunk {
  text: string
  timestamp: [number | null, number | null]
}

type AsrPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string; chunks?: AsrChunk[] }>

interface OrtWasmEnv {
  wasmPaths?: string | { mjs?: string | URL; wasm?: string | URL }
}

function applyOrtWasmPaths(paths: WhisperWorkerConfig['ortWasmPaths']): void {
  if (!paths) return
  const onnx: { wasm?: OrtWasmEnv } = env.backends.onnx
  onnx.wasm ??= {}
  onnx.wasm.wasmPaths = paths
  env.useWasmCache = false
}

async function resolveDevice(requested: 'webgpu' | 'wasm'): Promise<'webgpu' | 'wasm'> {
  if (requested !== 'webgpu') return requested
  if (typeof navigator === 'undefined' || !navigator.gpu) return 'wasm'
  const adapter = await navigator.gpu.requestAdapter().catch(() => null)
  return adapter === null ? 'wasm' : 'webgpu'
}

interface ModelFileProgressEvent {
  status?: string
  file?: string
  loaded?: number
  total?: number
}

function aggregateDownloadProgress(onProgress: (progress: number) => void): (event: ModelFileProgressEvent) => void {
  const files = new Map<string, { loaded: number; total: number }>()
  return (event) => {
    if (typeof event.file !== 'string') return
    if (event.status === 'progress' && typeof event.loaded === 'number' && typeof event.total === 'number') {
      files.set(event.file, { loaded: event.loaded, total: event.total })
    }
    const finished = event.status === 'done' ? files.get(event.file) : undefined
    if (finished) finished.loaded = finished.total
    let loaded = 0
    let total = 0
    for (const entry of files.values()) {
      loaded += entry.loaded
      total += entry.total
    }
    if (total > 0) onProgress(Math.min(1, loaded / total))
  }
}

let asrKey: string | null = null
let asrPromise: Promise<AsrPipeline> | null = null

function modelLoadError(model: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error)
  const host = new URL(env.remoteHost).host
  return new Error(`Could not load the Whisper model ${model} from ${host} (${reason}). Check the connection and try again.`)
}

async function ensurePipeline(config: WhisperWorkerConfig, onProgress: (progress: number) => void): Promise<AsrPipeline> {
  const device = await resolveDevice(config.device)
  const key = `${config.model}|${device}|${config.dtype}|${config.ortWasmPaths?.mjs ?? ''}|${config.ortWasmPaths?.wasm ?? ''}`
  if (asrKey !== key || !asrPromise) {
    asrKey = key
    applyOrtWasmPaths(config.ortWasmPaths)
    const loading = pipeline('automatic-speech-recognition', config.model, {
      device,
      dtype: config.dtype,
      progress_callback: aggregateDownloadProgress(onProgress),
    }) as unknown as Promise<AsrPipeline>
    const guarded = loading.catch((error: unknown) => {
      if (asrPromise === guarded) asrPromise = null
      throw modelLoadError(config.model, error)
    })
    asrPromise = guarded
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
): Promise<AsrChunk[] | null> {
  const baseOptions: Record<string, unknown> = {
    // onnx-community Whisper builds need a _timestamped export for word-level return_timestamps. https://huggingface.co/onnx-community/whisper-base_timestamped
    return_timestamps: 'word',
    ...whisperLanguageTaskOptions(multilingual, language),
  }
  for (const temperature of [0, 0.2, 0.4]) {
    const output = await asr(audio, {
      ...baseOptions,
      ...(temperature > 0 ? { temperature, do_sample: true } : {}),
    })
    if (!textHasRepetitionLoop(output.text)) return output.chunks ?? []
  }
  return null
}

function windowWords(raw: AsrChunk[], offsetMs: number): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const piece of raw) {
    const text = piece.text.trim()
    if (!text) continue
    const [startS, endS] = piece.timestamp
    const previousEndMs = words.at(-1)?.endMs ?? offsetMs
    const startMs = startS === null ? previousEndMs : Math.round(offsetMs + startS * 1000)
    const endMs = endS === null ? startMs : Math.round(offsetMs + endS * 1000)
    words.push({ text, startMs, endMs: Math.max(startMs, endMs) })
  }
  return words
}

async function handleTranscribe(message: WhisperWorkerRequest): Promise<TranscriptResult> {
  const { audio, config, language } = message
  const multilingual = !isEnglishOnlyWhisperModel(config.model)
  const asr = await ensurePipeline(config, (progress) => scope.postMessage({ type: 'progress', id: message.id, progress, phase: 'model' }))
  scope.postMessage({ type: 'progress', id: message.id, progress: 0, phase: 'transcribe' })

  const durationS = audio.length / WHISPER_SAMPLE_RATE
  const chunks = planChunks(durationS)
  const results: ChunkResult[] = []
  for (const [index, chunk] of chunks.entries()) {
    const window = audio.subarray(Math.floor(chunk.startS * WHISPER_SAMPLE_RATE), Math.floor(chunk.endS * WHISPER_SAMPLE_RATE))
    if (hasSpeech(window, WHISPER_SAMPLE_RATE)) {
      const raw = await transcribeWindow(asr, window, multilingual, language)
      if (raw) results.push({ chunk, words: windowWords(raw, chunk.startS * 1000) })
    }
    scope.postMessage({
      type: 'progress',
      id: message.id,
      progress: (index + 1) / chunks.length,
      phase: 'transcribe',
    })
  }

  const words = mergeChunkWords(results)
  return {
    text: words.map((w) => w.text).join(' '),
    ...(language ? { language } : {}),
    durationMs: Math.round(durationS * 1000),
    words,
    segments: segmentsFromWords(words),
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
