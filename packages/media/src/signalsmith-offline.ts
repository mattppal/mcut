/**
 * Offline buffer driver for signalsmith-stretch.
 *
 * The official npm build only ships an AudioWorklet wrapper, but export is
 * offline: we want the stretch as a pure samples-in/samples-out call that
 * works anywhere — main thread, dedicated workers (no OfflineAudioContext),
 * and Bun tests (no Web Audio at all). The worklet file detects its scope by
 * looking for `AudioWorkletProcessor`/`registerProcessor` globals, so we
 * shim those for the import, capture the registered processor class, and
 * pump its `process()` blocks ourselves instead of letting an AudioContext
 * drive it. The WASM engine and scheduling logic are untouched — only the
 * realtime callback is replaced with a loop.
 *
 * The processor reads the worklet globals `sampleRate` and `currentTime` as
 * free variables, so renders are serialized through a queue while those sit
 * on `globalThis`.
 */

/** Worklets process audio in fixed 128-frame quanta; the processor assumes the same. */
const BLOCK_FRAMES = 128

interface PortEvent {
  data: unknown[]
}

interface PortEnd {
  onmessage: ((event: PortEvent) => void) | null
  postMessage(data: unknown[], transfer?: unknown): void
}

/** A same-realm MessageChannel stand-in delivering on microtasks. */
function createPortPair(): { node: PortEnd; processor: PortEnd } {
  const node: PortEnd = {
    onmessage: null,
    postMessage: (data) => queueMicrotask(() => processor.onmessage?.({ data })),
  }
  const processor: PortEnd = {
    onmessage: null,
    postMessage: (data) => queueMicrotask(() => node.onmessage?.({ data })),
  }
  return { node, processor }
}

interface ProcessorInstance {
  process(
    inputList: Float32Array[][],
    outputList: Float32Array[][],
    parameters: Record<string, unknown>,
  ): boolean
}

type ProcessorClass = new (options: {
  numberOfInputs: number
  numberOfOutputs: number
  outputChannelCount: number[]
}) => ProcessorInstance

const globals = globalThis as Record<string, unknown>

/** Port handed to the next FakeAudioWorkletProcessor constructed. */
let nextProcessorPort: PortEnd | null = null

let processorClassPromise: Promise<ProcessorClass> | null = null

function loadProcessorClass(): Promise<ProcessorClass> {
  processorClassPromise ??= (async () => {
    let captured: ProcessorClass | undefined
    const hadProcessor = 'AudioWorkletProcessor' in globals
    const hadRegister = 'registerProcessor' in globals
    const previousProcessor = globals.AudioWorkletProcessor
    const previousRegister = globals.registerProcessor
    globals.AudioWorkletProcessor = class FakeAudioWorkletProcessor {
      port: PortEnd
      constructor() {
        const port = nextProcessorPort
        nextProcessorPort = null
        if (!port) throw new Error('FakeAudioWorkletProcessor constructed without a port')
        this.port = port
      }
    }
    globals.registerProcessor = (_name: string, cls: ProcessorClass) => {
      captured = cls
    }
    try {
      await import('signalsmith-stretch')
    } finally {
      if (hadProcessor) globals.AudioWorkletProcessor = previousProcessor
      else delete globals.AudioWorkletProcessor
      if (hadRegister) globals.registerProcessor = previousRegister
      else delete globals.registerProcessor
    }
    if (!captured) throw new Error('signalsmith-stretch did not register its worklet processor')
    return captured
  })()
  return processorClassPromise
}

/** Renders are serialized: the processor reads sampleRate/currentTime off globalThis. */
let renderQueue: Promise<unknown> = Promise.resolve()

/**
 * Stretch `channels` (equal-length planar PCM) by `tempo` (2 = twice as
 * fast), pitch preserved, producing exactly `outputFrames` frames per
 * channel. Same scheduling as the realtime node: play from input 0 at
 * `tempo` starting at output time 0.
 */
export function renderStretchOffline(
  channels: Float32Array[],
  sampleRate: number,
  tempo: number,
  outputFrames: number,
): Promise<Float32Array[]> {
  const run = renderQueue.then(() => doRender(channels, sampleRate, tempo, outputFrames))
  renderQueue = run.catch(() => {})
  return run
}

async function doRender(
  channels: Float32Array[],
  sampleRate: number,
  tempo: number,
  outputFrames: number,
): Promise<Float32Array[]> {
  if (channels.length === 0 || outputFrames <= 0) return channels.map(() => new Float32Array(0))
  const Processor = await loadProcessorClass()

  const hadSampleRate = 'sampleRate' in globals
  const hadCurrentTime = 'currentTime' in globals
  const previousSampleRate = globals.sampleRate
  const previousCurrentTime = globals.currentTime
  globals.sampleRate = sampleRate
  globals.currentTime = 0

  try {
    const { node, processor } = createPortPair()
    const pending = new Map<number, (value: unknown) => void>()
    let readyResolve!: () => void
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve
    })
    node.onmessage = ({ data }) => {
      const [id, value] = data
      if (id === 'ready') readyResolve()
      else if (typeof id === 'number') {
        pending.get(id)?.(value)
        pending.delete(id)
      }
      // 'time' progress updates are irrelevant offline.
    }

    nextProcessorPort = processor
    const instance = new Processor({
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channels.length],
    })
    await ready

    let idCounter = 0
    const call = (method: string, ...args: unknown[]): Promise<unknown> =>
      new Promise((resolve) => {
        const id = idCounter++
        pending.set(id, resolve)
        node.postMessage([id, method, ...args])
      })

    await call('addBuffers', channels)
    await call('schedule', { active: true, input: 0, output: 0, rate: tempo })

    const out = channels.map(() => new Float32Array(outputFrames))
    const block = channels.map(() => new Float32Array(BLOCK_FRAMES))
    let written = 0
    while (written < outputFrames) {
      globals.currentTime = written / sampleRate
      instance.process([[]], [block], {})
      const take = Math.min(BLOCK_FRAMES, outputFrames - written)
      for (let c = 0; c < channels.length; c++) {
        const source = take === BLOCK_FRAMES ? block[c]! : block[c]!.subarray(0, take)
        out[c]!.set(source, written)
      }
      written += take
    }
    return out
  } finally {
    if (hadSampleRate) globals.sampleRate = previousSampleRate
    else delete globals.sampleRate
    if (hadCurrentTime) globals.currentTime = previousCurrentTime
    else delete globals.currentTime
  }
}
