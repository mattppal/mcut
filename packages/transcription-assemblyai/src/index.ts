import { AssemblyAI, type TranscribeParams } from 'assemblyai'
import type {
  TranscribeInput,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptResult,
} from '@mcut/transcription'

/** The fields of an AssemblyAI transcript this package consumes (ms-native). */
export interface AssemblyAITranscriptLike {
  text?: string | null
  words?:
    | Array<{
        text: string
        start: number
        end: number
        confidence?: number
        speaker?: string | null
      }>
    | null
  utterances?:
    | Array<{ text: string; start: number; end: number; speaker?: string | null }>
    | null
  language_code?: string | null
  /** Seconds. */
  audio_duration?: number | null
}

/**
 * Normalize an AssemblyAI transcript to mcut's `TranscriptResult`.
 * AssemblyAI timestamps are already integer milliseconds; words carry
 * confidence and (with `speaker_labels`) speaker tags, and utterances map
 * to sentence-level segments.
 */
export function normalizeAssemblyAIResult(transcript: AssemblyAITranscriptLike): TranscriptResult {
  const words = (transcript.words ?? []).map((word) => ({
    text: word.text,
    startMs: Math.round(word.start),
    endMs: Math.round(word.end),
    ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
    ...(word.speaker != null ? { speaker: word.speaker } : {}),
  }))
  const segments = (transcript.utterances ?? []).map((utterance) => ({
    text: utterance.text,
    startMs: Math.round(utterance.start),
    endMs: Math.round(utterance.end),
    ...(utterance.speaker != null ? { speaker: utterance.speaker } : {}),
  }))
  return {
    text: transcript.text ?? '',
    ...(transcript.language_code != null ? { language: transcript.language_code } : {}),
    ...(transcript.audio_duration != null
      ? { durationMs: Math.round(transcript.audio_duration * 1000) }
      : {}),
    words,
    segments,
  }
}

export interface AssemblyAIProviderOptions {
  /** AssemblyAI API key. Keep server-side; never expose to the browser. */
  apiKey?: string
  /** Bring your own configured client instead of `apiKey`. */
  client?: AssemblyAI
  /** Label speakers (populates `speaker` on words/segments). Default true. */
  speakerLabels?: boolean
  /** Extra AssemblyAI request params (model, custom vocabulary, ...). */
  params?: Partial<Omit<TranscribeParams, 'audio'>>
  /** Provider id for diagnostics. Default `'assemblyai'`. */
  id?: string
}

async function toAudioArg(audio: TranscribeInput['audio']): Promise<string | Uint8Array> {
  if (typeof audio === 'string') return audio
  if (audio instanceof Blob) return new Uint8Array(await audio.arrayBuffer())
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio)
  return audio
}

/**
 * mcut's flagship transcription provider: native AssemblyAI with word-level
 * timestamps, per-word confidence, and speaker labels — everything caption
 * editing wants. Server-side only (the API key must stay secret); browsers
 * should POST audio to a route that runs this provider.
 *
 * ```ts
 * const provider = createAssemblyAIProvider({ apiKey: process.env.ASSEMBLYAI_API_KEY! })
 * const transcript = await provider.transcribe({ audio: wavBlob })
 * ```
 */
export function createAssemblyAIProvider(
  options: AssemblyAIProviderOptions = {},
): TranscriptionProvider {
  const apiKey = options.apiKey ?? process.env.ASSEMBLYAI_API_KEY
  const client =
    options.client ??
    (apiKey
      ? new AssemblyAI({ apiKey })
      : (() => {
          throw new Error(
            'createAssemblyAIProvider: pass `apiKey` or `client`, or set ASSEMBLYAI_API_KEY',
          )
        })())

  return {
    id: options.id ?? 'assemblyai',
    async transcribe(
      input: TranscribeInput,
      transcribeOptions?: TranscribeOptions,
    ): Promise<TranscriptResult> {
      const transcript = await client.transcripts.transcribe({
        audio: await toAudioArg(input.audio),
        speaker_labels: options.speakerLabels ?? true,
        ...(transcribeOptions?.language ? { language_code: transcribeOptions.language } : {}),
        ...options.params,
      })
      if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? 'unknown error'}`)
      }
      return normalizeAssemblyAIResult(transcript)
    },
  }
}
