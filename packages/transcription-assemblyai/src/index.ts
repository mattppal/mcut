import { AssemblyAI, type TranscribeParams } from 'assemblyai'
import type { TranscribeInput, TranscribeOptions, TranscriptionProvider, TranscriptResult } from '@mcut/transcription'

export interface AssemblyAITranscriptLike {
  text?: string | null
  words?: Array<{
    text: string
    start: number
    end: number
    confidence?: number
    speaker?: string | null
  }> | null
  utterances?: Array<{ text: string; start: number; end: number; speaker?: string | null }> | null
  language_code?: string | null
  audio_duration?: number | null
}

function millisecondsFromAssemblyAiDurationSeconds(audioDurationS: number): number {
  // word.start/end are milliseconds; audio_duration is seconds. https://www.assemblyai.com/docs/pre-recorded-audio/api-reference/transcripts/submit
  return Math.round(audioDurationS * 1000)
}

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
    ...(transcript.audio_duration != null ? { durationMs: millisecondsFromAssemblyAiDurationSeconds(transcript.audio_duration) } : {}),
    words,
    segments,
  }
}

export interface AssemblyAIProviderOptions {
  apiKey?: string
  client?: AssemblyAI
  speakerLabels?: boolean
  params?: Partial<Omit<TranscribeParams, 'audio'>>
  id?: string
}

async function toAudioArg(audio: TranscribeInput['audio']): Promise<string | Uint8Array> {
  if (typeof audio === 'string') return audio
  if (audio instanceof Blob) return new Uint8Array(await audio.arrayBuffer())
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio)
  return audio
}

const POLL_INTERVAL_MS = 3000

function cancellation(signal: AbortSignal): Error {
  return new Error('AssemblyAI transcription cancelled', { cause: signal.reason })
}

function waitForPoll(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  if (signal.aborted) return Promise.reject(cancellation(signal))
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      reject(cancellation(signal))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, POLL_INTERVAL_MS)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function createAssemblyAIProvider(options: AssemblyAIProviderOptions = {}): TranscriptionProvider {
  const apiKey = options.apiKey ?? process.env.ASSEMBLYAI_API_KEY
  const client =
    options.client ??
    (apiKey
      ? new AssemblyAI({ apiKey })
      : (() => {
          throw new Error('createAssemblyAIProvider: pass `apiKey` or `client`, or set ASSEMBLYAI_API_KEY')
        })())

  return {
    id: options.id ?? 'assemblyai',
    async transcribe(input: TranscribeInput, transcribeOptions?: TranscribeOptions): Promise<TranscriptResult> {
      const signal = transcribeOptions?.signal
      if (signal?.aborted) throw cancellation(signal)
      let transcript = await client.transcripts.submit({
        audio: await toAudioArg(input.audio),
        speaker_labels: options.speakerLabels ?? true,
        ...(transcribeOptions?.language ? { language_code: transcribeOptions.language } : {}),
        ...options.params,
      })
      while (transcript.status !== 'completed' && transcript.status !== 'error') {
        await waitForPoll(signal)
        transcript = await client.transcripts.get(transcript.id)
      }
      if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? 'unknown error'}`)
      }
      return normalizeAssemblyAIResult(transcript)
    },
  }
}
