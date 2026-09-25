import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource,
  BufferTarget,
  Input,
  Output,
  QUALITY_MEDIUM,
  type AudioCodec,
} from 'mediabunny'
import type { ContainerFormat } from './container-formats'

const PROBE_FRAMES = 8192
const CLICK_FRAME = 4096

const measured = new Map<string, Promise<number>>()

export function audioEncoderDelaySeconds(container: ContainerFormat, codec: AudioCodec, sampleRate: number): Promise<number> {
  const key = `${container.extension}:${codec}:${sampleRate}`
  let delay = measured.get(key)
  if (!delay) {
    delay = measureDelay(container, codec, sampleRate)
    measured.set(key, delay)
  }
  return delay
}

async function measureDelay(container: ContainerFormat, codec: AudioCodec, sampleRate: number): Promise<number> {
  const target = new BufferTarget()
  const output = new Output({ format: await container.createOutputFormat(), target })
  const source = new AudioSampleSource({ codec, bitrate: QUALITY_MEDIUM })
  output.addAudioTrack(source)
  await output.start()
  const data = new Float32Array(PROBE_FRAMES * 2)
  data[CLICK_FRAME] = 0.9
  data[PROBE_FRAMES + CLICK_FRAME] = 0.9
  const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate, timestamp: 0 })
  await source.add(sample)
  sample.close()
  await output.finalize()
  if (!target.buffer) return 0

  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer) })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return 0
    let peak = 0
    let peakTime = CLICK_FRAME / sampleRate
    for await (const decoded of new AudioSampleSink(track).samples()) {
      const frames = new Float32Array(decoded.numberOfFrames)
      decoded.copyTo(frames, { planeIndex: 0, format: 'f32-planar' })
      for (let i = 0; i < frames.length; i++) {
        const level = Math.abs(frames[i] ?? 0)
        if (level > peak) {
          peak = level
          peakTime = decoded.timestamp + i / decoded.sampleRate
        }
      }
      decoded.close()
    }
    return Math.max(0, Math.round(peakTime * sampleRate) - CLICK_FRAME) / sampleRate
  } finally {
    input.dispose()
  }
}
