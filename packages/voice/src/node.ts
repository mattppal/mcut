import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { cleanVoice as cleanVoiceWith, defaultWorkers, type CleanVoiceOptions, type SpawnWorker } from './pool'

export * from './index'

const wasmUrl = new URL('../wasm/df_bg.wasm', import.meta.url)
let wasm: Promise<WebAssembly.Module> | undefined

const spawn: SpawnWorker = (listeners) => {
  const worker = new Worker(new URL('./node-worker.js', import.meta.url))
  if (!(worker instanceof EventEmitter)) throw new TypeError('node:worker_threads Worker is not an EventEmitter')
  worker.on('message', listeners.message)
  worker.on('error', (error: Error) => listeners.error(error.message))
  worker.on('exit', (code: number) => listeners.error(`voice worker exited with code ${code}`))
  return worker
}

export async function cleanVoice(samples: Float32Array, options: CleanVoiceOptions = {}): Promise<Float32Array<ArrayBuffer>> {
  wasm ??= readFile(wasmUrl).then((bytes) => WebAssembly.compile(bytes))
  return cleanVoiceWith(samples, { ...options, workers: options.workers ?? defaultWorkers(availableParallelism()), spawn, wasm: await wasm })
}
