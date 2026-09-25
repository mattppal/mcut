import { describe, expect, test } from 'bun:test'
import { createLocalWhisperProvider } from './index'
import type { WhisperWorkerRequest, WhisperWorkerResponse } from './protocol'

function silentWav(): ArrayBuffer {
  const sampleRate = 16_000
  const frames = sampleRate / 10
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const writeAscii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, frames * 2, true)
  return buffer
}

type Behavior = 'hang' | 'fail-first-only' | 'slow-shared-download' | 'succeed'

class ScriptedWorker extends EventTarget {
  terminated = false
  private seen = 0

  constructor(private readonly behavior: Behavior) {
    super()
  }

  private readonly waiting: number[] = []

  postMessage(request: WhisperWorkerRequest): void {
    if (this.behavior === 'slow-shared-download') {
      this.waiting.push(request.id)
      if (this.waiting.length === 1) this.download(request.id, 6)
      return
    }
    const first = this.seen++ === 0
    queueMicrotask(() => {
      if (this.terminated) return
      if (this.behavior === 'fail-first-only' && first) {
        this.emit({ type: 'error', id: request.id, message: 'Could not load the Whisper model (fetch failed).' })
      }
      if (this.behavior !== 'succeed') return
      this.emit({ type: 'progress', id: request.id, progress: 0, phase: 'transcribe' })
      this.emit({ type: 'result', id: request.id, result: { text: 'ok', durationMs: 100, words: [], segments: [] } })
    })
  }

  terminate(): void {
    this.terminated = true
  }

  private download(firstId: number, ticksLeft: number): void {
    setTimeout(() => {
      if (this.terminated) return
      if (ticksLeft > 0) {
        this.emit({ type: 'progress', id: firstId, progress: 0.1, phase: 'model' })
        this.download(firstId, ticksLeft - 1)
        return
      }
      for (const id of this.waiting) {
        this.emit({ type: 'progress', id, progress: 0, phase: 'transcribe' })
        this.emit({ type: 'result', id, result: { text: 'ok', durationMs: 100, words: [], segments: [] } })
      }
    }, 10)
  }

  private emit(data: WhisperWorkerResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

function providerWith(behaviors: Behavior[], modelLoadTimeoutMs = 25) {
  const workers: ScriptedWorker[] = []
  const provider = createLocalWhisperProvider({
    modelLoadTimeoutMs,
    createWorker: () => {
      const worker = new ScriptedWorker(behaviors[workers.length] ?? 'succeed')
      workers.push(worker)
      return worker
    },
  })
  const transcribe = () => provider.transcribe({ audio: silentWav(), mimeType: 'audio/wav' })
  return { transcribe, workers }
}

describe('local whisper provider model load', () => {
  test('a model load that never answers rejects, and the next call gets a fresh worker', async () => {
    const { transcribe, workers } = providerWith(['hang', 'succeed'])
    await expect(transcribe()).rejects.toThrow('Timed out loading the Whisper model')
    expect(workers[0]?.terminated).toBe(true)
    await expect(transcribe()).resolves.toMatchObject({ text: 'ok' })
  })

  test('a load failure rejects every request waiting on that worker', async () => {
    const { transcribe, workers } = providerWith(['fail-first-only', 'succeed'], 60_000)
    const results = await Promise.allSettled([transcribe(), transcribe(), transcribe()])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(workers[0]?.terminated).toBe(true)
    await expect(transcribe()).resolves.toMatchObject({ text: 'ok' })
  })

  test('a download that keeps reporting progress does not time out a second waiter', async () => {
    const { transcribe } = providerWith(['slow-shared-download'])
    const results = await Promise.allSettled([transcribe(), transcribe()])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
  })

  test('every call settles after repeated load failures', async () => {
    const { transcribe } = providerWith(['fail-first-only', 'hang', 'fail-first-only', 'hang', 'succeed'])
    for (let i = 0; i < 4; i++) await expect(transcribe()).rejects.toThrow('Whisper model')
    await expect(transcribe()).resolves.toMatchObject({ text: 'ok' })
  })
})
