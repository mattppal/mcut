import type { MediaProbe, MediaProberId } from '../probe'

export interface ProbeRequest {
  id: number
  prober: MediaProberId
  path: string
}

export type ProbeReply = { id: number; kind: 'probe'; probe: MediaProbe } | { id: number; kind: 'threw'; typed: boolean; name: string; message: string }

export type ProbeOutcome =
  | { kind: 'probe'; probe: MediaProbe; elapsedMs: number }
  | { kind: 'threw'; typed: boolean; name: string; message: string; elapsedMs: number }
  | { kind: 'hang'; elapsedMs: number }
  | { kind: 'crash'; message: string; elapsedMs: number }

export const DEFAULT_PROBE_TIMEOUT_MS = 5000

export class ProbeRunner {
  private worker: Worker | null = null
  private nextId = 0
  readonly timeoutMs: number
  readonly prober: MediaProberId

  constructor(timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, prober: MediaProberId = 'mediabunny') {
    this.timeoutMs = timeoutMs
    this.prober = prober
  }

  probe(path: string): Promise<ProbeOutcome> {
    const worker = this.worker ?? this.spawn()
    const id = this.nextId++
    const started = performance.now()
    const elapsed = () => Math.round(performance.now() - started)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.close()
        resolve({ kind: 'hang', elapsedMs: elapsed() })
      }, this.timeoutMs)
      worker.onmessage = (event: MessageEvent<ProbeReply>) => {
        if (event.data.id !== id) return
        clearTimeout(timer)
        const { id: _id, ...reply } = event.data
        resolve({ ...reply, elapsedMs: elapsed() })
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        this.close()
        resolve({ kind: 'crash', message: event.message, elapsedMs: elapsed() })
      }
      worker.postMessage({ id, prober: this.prober, path } satisfies ProbeRequest)
    })
  }

  close(): void {
    this.worker?.terminate()
    this.worker = null
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./probe-worker.ts', import.meta.url).href)
    this.worker = worker
    return worker
  }
}
