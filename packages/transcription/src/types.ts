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

export interface TranscriptResult {
  text: string
  language?: string
  durationMs?: number
  words: TranscriptWord[]
  segments: TranscriptSegment[]
}

export interface TranscribeInput {
  audio: Blob | ArrayBuffer | Uint8Array | string
  mimeType?: string
}

export interface TranscribeOptions {
  language?: string
  signal?: AbortSignal
}

export interface TranscriptionProvider {
  readonly id: string
  transcribe(input: TranscribeInput, options?: TranscribeOptions): Promise<TranscriptResult>
}
