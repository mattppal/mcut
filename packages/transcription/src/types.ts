export interface TranscriptWord {
  text: string
  startMs: number
  endMs: number
  confidence?: number
  speaker?: string
}

export interface TranscriptSegment {
  text: string
  startMs: number
  endMs: number
  speaker?: string
}

/** Normalized transcription output, regardless of provider. */
export interface TranscriptResult {
  text: string
  /** ISO-639-1 code when detected. */
  language?: string
  durationMs?: number
  /** Word-level timings; may be empty for providers without word granularity. */
  words: TranscriptWord[]
  /** Sentence/utterance-level timings; may be empty. */
  segments: TranscriptSegment[]
}

export interface TranscribeInput {
  /** Audio payload: a Blob/File, raw bytes, or a URL the provider can fetch. */
  audio: Blob | ArrayBuffer | Uint8Array | string
  mimeType?: string
}

export interface TranscribeOptions {
  /** BCP-47/ISO language hint. */
  language?: string
  signal?: AbortSignal
}

/**
 * A pluggable transcription backend. Implementations are transport-agnostic:
 * they may call a cloud API (run them server-side and proxy from the
 * browser) or run a local model. See `@mcut/transcription-ai-sdk` for an
 * adapter over any Vercel AI SDK transcription model.
 */
export interface TranscriptionProvider {
  readonly id: string
  transcribe(input: TranscribeInput, options?: TranscribeOptions): Promise<TranscriptResult>
}
