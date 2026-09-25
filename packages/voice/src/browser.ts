import { cleanVoice as cleanVoiceWith, defaultWorkers, type CleanVoiceOptions, type SpawnWorker } from './pool'

export * from './index'

const wasmUrl = new URL('../wasm/df_bg.wasm', import.meta.url)
let wasm: Promise<WebAssembly.Module> | undefined

async function compileWasm(): Promise<WebAssembly.Module> {
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new Error(`could not load ${wasmUrl.href}, HTTP ${response.status}`)
  return WebAssembly.compile(await response.arrayBuffer())
}

const spawn: SpawnWorker = (listeners) => {
  const worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event) => listeners.message(event.data))
  worker.addEventListener('error', (event) => listeners.error(event.message || 'voice worker failed to start'))
  return worker
}

export async function cleanVoice(samples: Float32Array, options: CleanVoiceOptions = {}): Promise<Float32Array<ArrayBuffer>> {
  wasm ??= compileWasm().catch((error: unknown) => {
    wasm = undefined
    throw error
  })
  return cleanVoiceWith(samples, { ...options, workers: options.workers ?? defaultWorkers(navigator.hardwareConcurrency), spawn, wasm: await wasm })
}
