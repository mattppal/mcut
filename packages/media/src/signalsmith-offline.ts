// Audio worklets process 128-frame render quanta per https://webaudio.github.io/web-audio-api/#render-quantum-size
const BLOCK_FRAMES = 128

interface PortEvent {
  data: unknown[]
}

interface PortEnd {
  onmessage: ((event: PortEvent) => void) | null
  postMessage(data: unknown[], transfer?: unknown): void
}

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
  process(inputList: Float32Array[][], outputList: Float32Array[][], parameters: Record<string, unknown>): boolean
}

type ProcessorClass = new (options: { numberOfInputs: number; numberOfOutputs: number; outputChannelCount: number[] }) => ProcessorInstance

const globals = globalThis as Record<string, unknown>

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

let renderQueue: Promise<unknown> = Promise.resolve()

export function renderStretchOffline(channels: Float32Array[], sampleRate: number, tempo: number, outputFrames: number): Promise<Float32Array[]> {
  const run = renderQueue.then(
    () => doRender(channels, sampleRate, tempo, outputFrames),
    () => doRender(channels, sampleRate, tempo, outputFrames),
  )
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function doRender(channels: Float32Array[], sampleRate: number, tempo: number, outputFrames: number): Promise<Float32Array[]> {
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

    const lanes = channels.map(() => ({
      out: new Float32Array(outputFrames),
      block: new Float32Array(BLOCK_FRAMES),
    }))
    const block = lanes.map((lane) => lane.block)
    let written = 0
    while (written < outputFrames) {
      globals.currentTime = written / sampleRate
      instance.process([[]], [block], {})
      const take = Math.min(BLOCK_FRAMES, outputFrames - written)
      for (const lane of lanes) {
        const source = take === BLOCK_FRAMES ? lane.block : lane.block.subarray(0, take)
        lane.out.set(source, written)
      }
      written += take
    }
    return lanes.map((lane) => lane.out)
  } finally {
    if (hadSampleRate) globals.sampleRate = previousSampleRate
    else delete globals.sampleRate
    if (hadCurrentTime) globals.currentTime = previousCurrentTime
    else delete globals.currentTime
  }
}
