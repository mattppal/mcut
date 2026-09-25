import { z } from 'zod'
import { planChunks, stitchChunks, type Chunk, type CleanedChunk } from './chunks'
import { workerMessageSchema, type ChunkRequest } from './protocol'

export type VoiceProgress = { done: number; total: number }

export type VoiceWorkerListeners = {
  message: (data: unknown) => void
  error: (message: string) => void
}

export type VoiceWorker = {
  postMessage: (request: ChunkRequest, transfer: ArrayBuffer[]) => void
  terminate: () => void
}

export type SpawnWorker = (listeners: VoiceWorkerListeners) => VoiceWorker

export type CleanVoiceOptions = {
  workers?: number
  onProgress?: (progress: VoiceProgress) => void
  signal?: AbortSignal
}

export type VoiceRuntime = { spawn: SpawnWorker; wasm: WebAssembly.Module }

export class VoiceWorkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceWorkerError'
  }
}

export const defaultWorkers = (parallelism: number): number => Math.min(4, Math.max(1, parallelism - 1))

export async function cleanVoice(samples: Float32Array, options: CleanVoiceOptions & VoiceRuntime): Promise<Float32Array<ArrayBuffer>> {
  options.signal?.throwIfAborted()
  const chunks = planChunks(samples.length, options.workers ?? 1)
  const total = chunks.reduce((sum, chunk) => sum + chunk.to - chunk.from, 0)
  const done = chunks.map(() => 0)
  const report = (index: number, value: number): void => {
    done[index] = value
    options.onProgress?.({ done: done.reduce((sum, part) => sum + part, 0), total })
  }
  const stop = new AbortController()
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal])
  try {
    const cleaned = await Promise.all(
      chunks.map((chunk, index) => runChunk(chunk, samples.slice(chunk.from, chunk.to), options, signal, (value) => report(index, value))),
    )
    return stitchChunks(cleaned, samples.length)
  } finally {
    stop.abort()
  }
}

function runChunk(
  chunk: Chunk,
  input: Float32Array<ArrayBuffer>,
  { spawn, wasm }: VoiceRuntime,
  signal: AbortSignal,
  onProgress: (done: number) => void,
): Promise<CleanedChunk> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void): void => {
      signal.removeEventListener('abort', abort)
      worker.terminate()
      finish()
    }
    const abort = (): void => settle(() => reject(signal.reason))
    const fail = (message: string): void => settle(() => reject(new VoiceWorkerError(message)))
    const worker = spawn({
      message: (data) => {
        if (signal.aborted) return
        const parsed = workerMessageSchema.safeParse(data)
        if (!parsed.success) return fail(`unexpected voice worker message. ${z.prettifyError(parsed.error)}`)
        const message = parsed.data
        switch (message.type) {
          case 'progress':
            return onProgress(message.done)
          case 'done':
            return settle(() => resolve({ ...chunk, samples: message.samples }))
          case 'error':
            return fail(message.message)
          default: {
            const unhandled: never = message
            return unhandled
          }
        }
      },
      error: fail,
    })
    signal.addEventListener('abort', abort, { once: true })
    worker.postMessage({ samples: input, wasm }, [input.buffer])
  })
}
