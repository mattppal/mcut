const RIFF = 0x52494646
const WAVE = 0x57415645
const FMT = 0x666d7420
const DATA = 0x64617461
const PCM = 1
const EXTENSIBLE = 0xfffe

type WavFormat = { encoding: number; channels: number; sampleRate: number; bits: number }

type SampleReader = (view: DataView, at: number) => number

const readers = new Map<string, SampleReader>([
  ['1/16', (view, at) => view.getInt16(at, true) / 0x8000],
  ['3/32', (view, at) => view.getFloat32(at, true)],
])

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, RIFF)
  view.setUint32(4, 36 + samples.length * 2, true)
  view.setUint32(8, WAVE)
  view.setUint32(12, FMT)
  view.setUint32(16, 16, true)
  view.setUint16(20, PCM, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, DATA)
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    view.setInt16(44 + index * 2, Math.max(-0x8000, Math.min(0x7fff, Math.round(sample * 0x8000))), true)
  })
  return bytes
}

export function decodeWav(bytes: Uint8Array): { samples: Float32Array<ArrayBuffer>; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 12 || view.getUint32(0) !== RIFF || view.getUint32(8) !== WAVE) throw new Error('not a RIFF WAVE file')
  let format: WavFormat | undefined
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = view.getUint32(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === FMT) format = readFormat(view, body)
    if (id === DATA) {
      if (format === undefined) throw new Error('WAV data chunk comes before its fmt chunk')
      return { samples: readSamples(view, body, Math.min(view.byteLength, body + size), format), sampleRate: format.sampleRate }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV file has no data chunk')
}

function readFormat(view: DataView, body: number): WavFormat {
  const tag = view.getUint16(body, true)
  return {
    encoding: tag === EXTENSIBLE ? view.getUint16(body + 24, true) : tag,
    channels: view.getUint16(body + 2, true),
    sampleRate: view.getUint32(body + 4, true),
    bits: view.getUint16(body + 14, true),
  }
}

function readSamples(view: DataView, start: number, end: number, format: WavFormat): Float32Array<ArrayBuffer> {
  const read = readers.get(`${format.encoding}/${format.bits}`)
  if (read === undefined || format.channels === 0) {
    throw new Error(`unsupported WAV encoding ${format.encoding} with ${format.bits}-bit samples, expected 16-bit PCM or 32-bit float`)
  }
  const width = format.bits / 8
  const frameBytes = width * format.channels
  const samples = new Float32Array(Math.floor((end - start) / frameBytes))
  for (let frame = 0; frame < samples.length; frame++) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel++) sum += read(view, start + frame * frameBytes + channel * width)
    samples[frame] = sum / format.channels
  }
  return samples
}
