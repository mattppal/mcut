import { describe, expect, test } from 'bun:test'
import { VoiceWorkerError, cleanVoice, type SpawnWorker, type VoiceProgress, type VoiceWorkerListeners } from './index'

const wasm = new WebAssembly.Module(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00))

function fakeWorkers(respond: (samples: Float32Array, listeners: VoiceWorkerListeners, index: number) => void) {
  const terminated: boolean[] = []
  const spawn: SpawnWorker = (listeners) => {
    const index = terminated.push(false) - 1
    return {
      postMessage: ({ samples }) => queueMicrotask(() => respond(samples, listeners, index)),
      terminate: () => {
        terminated[index] = true
      },
    }
  }
  return { spawn, terminated }
}

describe('cleanVoice pool', () => {
  test('stitches chunk outputs back into the input when every worker returns its input', async () => {
    const input = Float32Array.from({ length: 144_000 }, (_, index) => Math.sin(index / 7))
    const progress: VoiceProgress[] = []
    const { spawn, terminated } = fakeWorkers((samples, listeners) => {
      listeners.message({ type: 'progress', done: samples.length })
      listeners.message({ type: 'done', samples })
    })
    const output = await cleanVoice(input, { workers: 3, spawn, wasm, onProgress: (update) => progress.push(update) })
    expect(output).toEqual(input)
    expect(progress.at(-1)).toEqual({ done: 244_800, total: 244_800 })
    expect(terminated).toEqual([true, true, true])
  })

  test('rejects with VoiceWorkerError and terminates every worker when one fails', async () => {
    const { spawn, terminated } = fakeWorkers((_, listeners, index) => {
      if (index === 1) listeners.message({ type: 'error', message: 'wasm trapped' })
    })
    const failure = await cleanVoice(new Float32Array(144_000), { workers: 3, spawn, wasm }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VoiceWorkerError)
    expect(failure).toMatchObject({ name: 'VoiceWorkerError', message: 'wasm trapped' })
    expect(terminated).toEqual([true, true, true])
  })

  test('rejects a worker message outside the protocol', async () => {
    const { spawn } = fakeWorkers((_, listeners) => listeners.message({ type: 'done' }))
    await expect(cleanVoice(new Float32Array(48_000), { spawn, wasm })).rejects.toThrow('unexpected voice worker message')
  })
})
