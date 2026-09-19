import { z } from 'zod'

const transcriptWordSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  confidence: z.number().optional(),
  speaker: z.string().optional(),
})

const transcriptSegmentSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  speaker: z.string().optional(),
})

export const transcriptResultSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationMs: z.number().optional(),
  words: z.array(transcriptWordSchema),
  segments: z.array(transcriptSegmentSchema),
})

export const transcriptInputSchema = transcriptResultSchema.extend({
  text: z.string().default(''),
  words: z.array(transcriptWordSchema).default([]),
  segments: z.array(transcriptSegmentSchema).default([]),
})

export interface TranscriptWord extends z.infer<typeof transcriptWordSchema> {}

export interface TranscriptSegment extends z.infer<typeof transcriptSegmentSchema> {}

export interface TranscriptResult extends z.infer<typeof transcriptResultSchema> {}

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
