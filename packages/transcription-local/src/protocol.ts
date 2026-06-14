import type { TranscriptResult } from '@mcut/transcription'

/** Wire protocol between the provider façade and the Whisper worker. */

/** Quantization levels the worker accepts (transformers.js DataType subset). */
export type WhisperDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16'

export interface WhisperWorkerConfig {
  /** HF model id, e.g. "onnx-community/whisper-base". */
  model: string
  device: 'webgpu' | 'wasm'
  /** Quantization, e.g. "q8". */
  dtype: WhisperDtype
}

export interface WhisperTranscribeRequest {
  type: 'transcribe'
  id: number
  config: WhisperWorkerConfig
  /** Mono PCM at 16kHz (transferred). */
  audio: Float32Array
  language?: string
}

export type WhisperWorkerRequest = WhisperTranscribeRequest

export type WhisperWorkerResponse =
  | { type: 'ready' }
  | {
      type: 'progress'
      id: number
      /** 0–1 within the phase. */
      progress: number
      /** Model download/load vs. actual transcription. */
      phase: 'model' | 'transcribe'
    }
  | { type: 'result'; id: number; result: TranscriptResult }
  | { type: 'error'; id: number; message: string }
