import { experimental_transcribe as transcribe } from 'ai'
import type {
  TranscribeInput,
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptResult,
} from '@mcut/transcription'

type TranscribeArgs = Parameters<typeof transcribe>[0]

export interface AISDKTranscriptionProviderOptions {
  model: TranscribeArgs['model']
  providerOptions?: TranscribeArgs['providerOptions']
  id?: string
}

export interface AISDKTranscriptionResultLike {
  text: string
  segments: ReadonlyArray<{ text: string; startSecond: number; endSecond: number }>
  language: string | undefined
  durationInSeconds: number | undefined
}

function everySegmentIsASingleWord(segments: ReadonlyArray<{ text: string }>): boolean {
  return segments.length > 0 && segments.every((segment) => !/\s/.test(segment.text))
}

export function normalizeAISDKResult(result: AISDKTranscriptionResultLike): TranscriptResult {
  const mapped = result.segments.map((segment) => ({
    text: segment.text.trim(),
    startMs: Math.round(segment.startSecond * 1000),
    endMs: Math.round(segment.endSecond * 1000),
  }))
  const isWordLevel = everySegmentIsASingleWord(mapped)
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
