import { assertNever } from '@mcut/timeline'
import { faceDetectResponseSchema, type FaceDetectorProgress, type FaceDetectRequest, type FaceSample, type OrtWasmPaths } from './face-detector-protocol'
import type { MediaSourceLike } from './probe'

const DEFAULT_SAMPLE_RATE_HZ = 5

interface LocalFaceDetectorOptions {
  ortWasmPaths?: OrtWasmPaths
  onProgress?: (progress: FaceDetectorProgress) => void
  createWorker?: () => Worker
}

interface DetectFacesOptions {
  sampleRateHz?: number
  signal?: AbortSignal
}

interface LocalFaceDetector {
  detect(src: MediaSourceLike, options?: DetectFacesOptions): Promise<FaceSample[]>
}

function resolveAgainstDocument(src: MediaSourceLike): MediaSourceLike {
  if (typeof src !== 'string' || typeof location === 'undefined') return src
  return new URL(src, location.href).href
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
}

export function createLocalFaceDetector(options: LocalFaceDetectorOptions = {}): LocalFaceDetector {
  let worker: Worker | null = null
  let nextId = 0
  let queue: Promise<unknown> = Promise.resolve()

  const run = (request: FaceDetectRequest, signal: AbortSignal | undefined): Promise<FaceSample[]> =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted()
      const target = (worker ??= options.createWorker?.() ?? new Worker(new URL('./face-detector-worker.js', import.meta.url), { type: 'module' }))
      const detach = (): void => {
        target.removeEventListener('message', onMessage)
        target.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const fail = (reason: unknown): void => {
        detach()
        target.terminate()
        if (worker === target) worker = null
        reject(reason)
      }
      const onAbort = (): void => fail(signal?.reason)
      const onError = (event: ErrorEvent): void => fail(new Error(`The face detector worker failed (${event.message || 'its script did not load'})`))
      const onMessage = (event: MessageEvent<unknown>): void => {
        const parsed = faceDetectResponseSchema.safeParse(event.data)
        if (!parsed.success) return fail(new Error('The face detector worker sent a malformed message', { cause: parsed.error }))
        const message = parsed.data
        if (message.id !== request.id) return
        switch (message.type) {
          case 'progress':
            options.onProgress?.({ phase: message.phase, progress: message.progress })
            return
          case 'result':
            detach()
            return resolve(message.samples)
          case 'error':
            return fail(new Error(message.message))
          default:
            return assertNever(message)
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      target.addEventListener('message', onMessage)
      target.addEventListener('error', onError)
      target.postMessage(request)
    })

  return {
    async detect(src, { sampleRateHz = DEFAULT_SAMPLE_RATE_HZ, signal } = {}) {
      if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) throw new RangeError(`sampleRateHz must be a positive number, got ${sampleRateHz}`)
      signal?.throwIfAborted()
      const request: FaceDetectRequest = {
        type: 'detect',
        id: nextId++,
        src: resolveAgainstDocument(src),
        sampleRateHz,
        ...(options.ortWasmPaths ? { ortWasmPaths: options.ortWasmPaths } : {}),
      }
      const turn = queue.then(() => run(request, signal))
      queue = turn.catch(() => undefined)
      return signal ? Promise.race([turn, rejectOnAbort(signal)]) : turn
    },
  }
}
