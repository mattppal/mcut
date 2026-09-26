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
    postMessage: (data) => processor.onmessage?.({ data }),
  }
  const processor: PortEnd = {
    onmessage: null,
    postMessage: (data) => node.onmessage?.({ data }),
  }
  return { node, processor }
}

interface ProcessorInstance {
  process(inputList: Float32Array[][], outputList: Float32Array[][], parameters: Record<string, unknown>): boolean
  inputLatencySeconds?: number
  outputLatencySeconds?: number
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

function withWorkletClock<T>(sampleRate: number, currentTime: number, run: () => T): T {
  const hadSampleRate = 'sampleRate' in globals
  const hadCurrentTime = 'currentTime' in globals
  const previousSampleRate = globals.sampleRate
  const previousCurrentTime = globals.currentTime
  globals.sampleRate = sampleRate
  globals.currentTime = currentTime
  try {
    return run()
  } finally {
    if (hadSampleRate) globals.sampleRate = previousSampleRate
    else delete globals.sampleRate
    if (hadCurrentTime) globals.currentTime = previousCurrentTime
    else delete globals.currentTime
  }
}

let openQueue: Promise<unknown> = Promise.resolve()

async function construct(Processor: ProcessorClass, node: PortEnd, processor: PortEnd, channelCount: number, sampleRate: number): Promise<ProcessorInstance> {
  const hadSampleRate = 'sampleRate' in globals
  const previousSampleRate = globals.sampleRate
  globals.sampleRate = sampleRate
  try {
    const ready = new Promise<void>((resolve) => {
      node.onmessage = ({ data }) => {
        if (data[0] === 'ready') resolve()
      }
    })
    nextProcessorPort = processor
    const instance = withWorkletClock(sampleRate, 0, () => new Processor({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channelCount] }))
    await ready
    return instance
  } finally {
    if (hadSampleRate) globals.sampleRate = previousSampleRate
    else delete globals.sampleRate
  }
}

export class StretchStream {
  private rendered = 0
  private leftover: Float32Array[]
  private readonly block: Float32Array[]
  private input: Float32Array[]
  private inputStart = 0
  private inputFrames = 0
  private loadedStart = 0
  private loadedFrames = 0

  private constructor(
    private readonly instance: ProcessorInstance,
    private readonly node: PortEnd,
    channelCount: number,
    private readonly sampleRate: number,
    private readonly tempo: number,
  ) {
    this.block = Array.from({ length: channelCount }, () => new Float32Array(BLOCK_FRAMES))
    this.leftover = this.block.map(() => new Float32Array(0))
    this.input = this.block.map(() => new Float32Array(0))
  }

  static async open(channelCount: number, sampleRate: number, tempo: number): Promise<StretchStream> {
    const Processor = await loadProcessorClass()
    const { node, processor } = createPortPair()
    const opening = openQueue.then(() => construct(Processor, node, processor, channelCount, sampleRate))
    openQueue = opening.then(
      () => undefined,
      () => undefined,
    )
    const stream = new StretchStream(await opening, node, channelCount, sampleRate, tempo)
    stream.invoke('schedule', { active: true, input: 0, output: 0, rate: tempo })
    return stream
  }

  inputFramesFor(outputFrames: number): number {
    const inputS = this.instance.inputLatencySeconds ?? 0
    const outputS = this.instance.outputLatencySeconds ?? 0
    const blocks = Math.ceil(Math.max(0, outputFrames - this.leftoverFrames()) / BLOCK_FRAMES)
    const lastBlockS = (this.rendered + Math.max(0, blocks - 1) * BLOCK_FRAMES) / this.sampleRate
    return Math.ceil(((lastBlockS + outputS) * this.tempo + inputS) * this.sampleRate) + 1
  }

  append(channels: Float32Array[]): void {
    const frames = channels[0]?.length ?? 0
    if (frames === 0) return
    const used = this.inputFrames - this.inputStart
    this.input = this.input.map((lane, channel) => {
      const grown = new Float32Array(used + frames)
      grown.set(lane.subarray(0, used))
      grown.set(channels[Math.min(channel, channels.length - 1)] ?? new Float32Array(0), used)
      return grown
    })
    this.inputFrames += frames
  }

  render(frames: number): Float32Array[] {
    this.reloadAsOneBuffer()
    const out = this.block.map(() => new Float32Array(Math.max(0, frames)))
    let written = 0
    const fromLeftover = Math.min(frames, this.leftoverFrames())
    if (fromLeftover > 0) {
      for (const [channel, lane] of out.entries()) lane.set(this.leftover[channel]?.subarray(0, fromLeftover) ?? new Float32Array(0))
      this.leftover = this.leftover.map((lane) => lane.subarray(fromLeftover))
      written = fromLeftover
    }
    while (written < frames) {
      withWorkletClock(this.sampleRate, this.rendered / this.sampleRate, () => this.instance.process([[]], [this.block], {}))
      this.rendered += BLOCK_FRAMES
      const take = Math.min(BLOCK_FRAMES, frames - written)
      for (const [channel, lane] of out.entries()) lane.set(this.block[channel]?.subarray(0, take) ?? new Float32Array(0), written)
      if (take < BLOCK_FRAMES) this.leftover = this.block.map((lane) => lane.slice(take))
      written += take
    }
    return out
  }

  private reloadAsOneBuffer(): void {
    const keepFrom = Math.max(this.inputStart, Math.floor(this.rendered * this.tempo) - this.sampleRate)
    if (keepFrom === this.loadedStart && this.inputFrames === this.loadedFrames) return
    this.input = this.input.map((lane) => lane.slice(keepFrom - this.inputStart))
    this.inputStart = keepFrom
    this.invoke('dropBuffers')
    this.invoke('addBuffers', this.input)
    if (keepFrom !== this.loadedStart) {
      const outputS = this.rendered / this.sampleRate
      this.invoke('schedule', { active: true, output: outputS, input: outputS * this.tempo - keepFrom / this.sampleRate, rate: this.tempo })
    }
    this.loadedStart = keepFrom
    this.loadedFrames = this.inputFrames
  }

  private leftoverFrames(): number {
    return this.leftover[0]?.length ?? 0
  }

  private invoke(method: string, ...args: unknown[]): void {
    withWorkletClock(this.sampleRate, this.rendered / this.sampleRate, () => this.node.postMessage([0, method, ...args]))
  }
}

export async function renderStretchOffline(channels: Float32Array[], sampleRate: number, tempo: number, outputFrames: number): Promise<Float32Array[]> {
  if (channels.length === 0 || outputFrames <= 0) return channels.map(() => new Float32Array(0))
  const stream = await StretchStream.open(channels.length, sampleRate, tempo)
  stream.append(channels)
  return stream.render(outputFrames)
}
