import type { TranscriptResult } from '@mcut/transcription'

export type WhisperDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16'

export interface WhisperWorkerConfig {
  model: string
  device: 'webgpu' | 'wasm'
  dtype: WhisperDtype
  ortWasmPaths?: { mjs: string; wasm: string }
}

export interface WhisperTranscribeRequest {
  type: 'transcribe'
  id: number
  config: WhisperWorkerConfig
  audio: Float32Array
  language?: string
}

export type WhisperWorkerRequest = WhisperTranscribeRequest

export type WhisperWorkerResponse =
  | { type: 'ready' }
  | {
      type: 'progress'
      id: number
      progress: number
      phase: 'model' | 'transcribe'
    }
  | { type: 'result'; id: number; result: TranscriptResult }
  | { type: 'error'; id: number; message: string }
