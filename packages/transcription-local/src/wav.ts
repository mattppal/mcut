/**
 * Minimal WAV reader → 16kHz mono Float32Array (Whisper's input format).
 * The editor extracts clip audio as 16kHz WAV already (`extractAudioToWav`),
 * so this covers the hot path without any AudioContext — it runs in workers
 * and tests alike. Non-WAV input falls back to decodeAudioData upstream.
 */

export const WHISPER_SAMPLE_RATE = 16_000

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: number
}

/** Parse a PCM/float WAV file. Returns null when it isn't one. */
export function parseWav(buffer: ArrayBuffer): DecodedAudio | null {
  const view = new DataView(buffer)
  if (buffer.byteLength < 44) return null
  if (view.getUint32(0) !== 0x52494646 /* RIFF */) return null
  if (view.getUint32(8) !== 0x57415645 /* WAVE */) return null

  let offset = 12
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  while (offset + 8 <= buffer.byteLength) {
    const id = view.getUint32(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 0x666d7420 /* fmt  */) {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 0x64617461 /* data */ && format) {
      const end = Math.min(buffer.byteLength, body + size)
      return decodeData(view, body, end, format)
    }
    offset = body + size + (size % 2)
  }
  return null
}

function decodeData(
  view: DataView,
  start: number,
  end: number,
  format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number },
): DecodedAudio | null {
  const { audioFormat, channels, sampleRate, bitsPerSample } = format
  if (channels < 1 || sampleRate <= 0) return null
  const bytesPerSample = bitsPerSample / 8
  const frameBytes = bytesPerSample * channels
  const frames = Math.floor((end - start) / frameBytes)
  const samples = new Float32Array(frames)

  const read = (at: number): number => {
    if (audioFormat === 3 && bitsPerSample === 32) return view.getFloat32(at, true)
    if (audioFormat === 1 && bitsPerSample === 16) return view.getInt16(at, true) / 0x8000
    if (audioFormat === 1 && bitsPerSample === 32) return view.getInt32(at, true) / 0x80000000
    if (audioFormat === 1 && bitsPerSample === 8) return (view.getUint8(at) - 128) / 128
    if (audioFormat === 1 && bitsPerSample === 24) {
      const value =
        view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getInt8(at + 2) << 16)
      return value / 0x800000
    }
    return Number.NaN
  }
  // Probe the first frame for an unsupported encoding before looping.
  if (frames > 0 && Number.isNaN(read(start))) return null

  for (let frame = 0; frame < frames; frame++) {
    const at = start + frame * frameBytes
    let sum = 0
    for (let c = 0; c < channels; c++) sum += read(at + c * bytesPerSample)
    samples[frame] = sum / channels
  }
  return { samples, sampleRate }
}

/** Linear-interpolation resample (fine for speech models). */
export function resampleTo(audio: DecodedAudio, targetRate: number): Float32Array {
  if (audio.sampleRate === targetRate) return audio.samples
  const ratio = audio.sampleRate / targetRate
  const length = Math.max(1, Math.round(audio.samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const a = audio.samples[Math.min(index, audio.samples.length - 1)]!
    const b = audio.samples[Math.min(index + 1, audio.samples.length - 1)]!
    out[i] = a + (b - a) * fraction
  }
  return out
}
