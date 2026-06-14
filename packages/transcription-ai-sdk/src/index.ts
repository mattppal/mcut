import { experimental_transcribe as transcribe } from 'ai'
import type {
  TranscribeInput,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptResult,
} from '@mcut/transcription'

type TranscribeArgs = Parameters<typeof transcribe>[0]

export interface AISDKTranscriptionProviderOptions {
  /** Any AI SDK transcription model, e.g. `openai.transcription('whisper-1')`. */
  model: TranscribeArgs['model']
  /**
   * Provider-specific options forwarded to the AI SDK, e.g.
   * `{ openai: { timestampGranularities: ['word'] } }` for word timings.
   */
  providerOptions?: TranscribeArgs['providerOptions']
  /** Provider id for diagnostics. Default `'ai-sdk'`. */
  id?: string
}

/** The fields of the AI SDK transcription result this adapter consumes. */
export interface AISDKTranscriptionResultLike {
  text: string
  segments: ReadonlyArray<{ text: string; startSecond: number; endSecond: number }>
  language: string | undefined
  durationInSeconds: number | undefined
}

/**
 * Normalize an AI SDK transcription result to mcut's `TranscriptResult`.
 * Word-granularity outputs (every segment a single word) are detected and
 * exposed as `words` so captions get karaoke timings; sentence-level
 * segments pass through as `segments`.
 */
export function normalizeAISDKResult(result: AISDKTranscriptionResultLike): TranscriptResult {
  const mapped = result.segments.map((segment) => ({
    text: segment.text.trim(),
    startMs: Math.round(segment.startSecond * 1000),
    endMs: Math.round(segment.endSecond * 1000),
  }))
  const isWordLevel = mapped.length > 0 && mapped.every((s) => !/\s/.test(s.text))
  return {
    text: result.text,
    ...(result.language !== undefined ? { language: result.language } : {}),
    ...(result.durationInSeconds !== undefined
      ? { durationMs: Math.round(result.durationInSeconds * 1000) }
      : {}),
    words: isWordLevel ? mapped : [],
    segments: isWordLevel ? [] : mapped,
  }
}

async function toAudioArg(audio: TranscribeInput['audio']): Promise<TranscribeArgs['audio']> {
  if (typeof audio === 'string') return new URL(audio)
  if (audio instanceof Blob) return new Uint8Array(await audio.arrayBuffer())
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio)
  return audio
}

/**
 * An mcut transcription provider backed by the Vercel AI SDK — one adapter
 * unlocks every AI SDK transcription model (OpenAI, Deepgram, Groq,
 * ElevenLabs, AssemblyAI, ...). Runs wherever the AI SDK runs; keep API
 * keys server-side.
 *
 * ```ts
 * import { openai } from '@ai-sdk/openai'
 * const provider = createAISDKTranscriptionProvider({
 *   model: openai.transcription('whisper-1'),
 *   providerOptions: { openai: { timestampGranularities: ['word'] } },
 * })
 * const transcript = await provider.transcribe({ audio: wavBlob })
 * ```
 */
export function createAISDKTranscriptionProvider(
  options: AISDKTranscriptionProviderOptions,
): TranscriptionProvider {
  return {
    id: options.id ?? 'ai-sdk',
    async transcribe(
      input: TranscribeInput,
      transcribeOptions?: TranscribeOptions,
    ): Promise<TranscriptResult> {
      const result = await transcribe({
        model: options.model,
        audio: await toAudioArg(input.audio),
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
        ...(transcribeOptions?.signal ? { abortSignal: transcribeOptions.signal } : {}),
      })
      return normalizeAISDKResult(result)
    },
  }
}
