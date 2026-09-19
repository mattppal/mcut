import { createAssemblyAIProvider } from '@mcut/transcription-assemblyai'
import type { DesktopSettings } from './settings'

const TRANSCRIBE_TIMEOUT_MS = 10 * 60 * 1000

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function transcribeOptions(language: string | undefined, signal: AbortSignal): { language?: string; signal: AbortSignal } {
  return language === undefined ? { signal } : { language, signal }
}

function combineAbortSignals(timeout: AbortSignal, existing: AbortSignal | null | undefined): AbortSignal {
  return existing == null ? timeout : AbortSignal.any([timeout, existing])
}

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

async function withFetchSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch
  globalThis.fetch = new Proxy(previous, {
    apply(target, thisArg, argArray: Parameters<typeof fetch>) {
      const [input, init] = argArray
      return target.call(thisArg, input, { ...init, signal: combineAbortSignals(signal, init?.signal) })
    },
  })
  try {
    return await run()
  } finally {
    globalThis.fetch = previous
  }
}

async function readAudioForm(request: Request): Promise<{ audio: Blob; language: string | undefined } | Response> {
  try {
    const form = await request.formData()
    const audio = form.get('audio')
    if (!(audio instanceof Blob) || audio.size === 0) {
      return Response.json({ error: 'Expected multipart form data with a non-empty "audio" file.' }, { status: 400 })
    }
    const language = form.get('language')
    return { audio, language: typeof language === 'string' && language.length > 0 ? language : undefined }
  } catch (error) {
    return Response.json({ error: `Expected multipart form data. ${failureMessage(error)}` }, { status: 400 })
  }
}

function readTranscriptionKey(settings: DesktopSettings): string | Response {
  try {
    const key = settings.transcriptionKey()
    if (key !== null) return key
  } catch (error) {
    return Response.json({ error: `The stored AssemblyAI key could not be read, enter it again. ${failureMessage(error)}` }, { status: 401 })
  }
  return Response.json({ error: 'Transcription is not configured. Add an AssemblyAI API key in the Captions panel.' }, { status: 401 })
}

export async function handleTranscribeRequest(request: Request, settings: DesktopSettings): Promise<Response> {
  const key = readTranscriptionKey(settings)
  if (key instanceof Response) return key
  const form = await readAudioForm(request)
  if (form instanceof Response) return form
  const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
  try {
    const provider = createAssemblyAIProvider({ apiKey: key })
    const result = await withFetchSignal(signal, () =>
      Promise.race([
        provider.transcribe({ audio: form.audio, mimeType: form.audio.type || 'audio/wav' }, transcribeOptions(form.language, signal)),
        whenAborted(signal),
      ]),
    )
    return Response.json(result)
  } catch (error) {
    if (signal.aborted) {
      return Response.json({ error: 'AssemblyAI transcription failed. Transcription timed out after 10 minutes.' }, { status: 502 })
    }
    return Response.json({ error: `AssemblyAI transcription failed. ${failureMessage(error)}` }, { status: 502 })
  }
}
