import { transcriptResultSchema, type TranscribeOptions, type TranscriptResult } from '@mcut/transcription'
import { z } from 'zod'
import { isOnDeviceTranscriptionEnabled, transcribeOnDevice } from '@/registry/mcut/local-transcription'

const transcribeFailureSchema = z.object({ error: z.string() })

async function transcribeRemote(audio: Blob, options?: TranscribeOptions): Promise<TranscriptResult> {
  const form = new FormData()
  form.append('audio', audio, 'audio.wav')
  for (const term of options?.vocabulary ?? []) form.append('vocabulary', term)
  const response = await fetch('/api/transcribe', { method: 'POST', body: form })
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  if (!response.ok) {
    const failure = isJson ? transcribeFailureSchema.safeParse(await response.json()) : undefined
    throw new Error(failure?.success ? failure.data.error : `Transcription failed (${response.status})`)
  }
  if (!isJson) {
    throw new Error(`Transcription returned an unexpected response: ${response.headers.get('content-type') ?? 'no content type'}`)
  }
  const json: unknown = await response.json()
  const result = transcriptResultSchema.safeParse(json)
  if (!result.success) {
    throw new Error(`Transcription returned an unexpected response: ${z.prettifyError(result.error)}`)
  }
  return result.data
}

export function transcribe(audio: Blob, options?: TranscribeOptions): Promise<TranscriptResult> {
  return isOnDeviceTranscriptionEnabled() ? transcribeOnDevice(audio, options) : transcribeRemote(audio, options)
}
