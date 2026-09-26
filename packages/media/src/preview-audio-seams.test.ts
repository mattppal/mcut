import { describe, expect, test } from 'bun:test'
import type { AudioBufferSink, WrappedAudioBuffer } from 'mediabunny'
import { decodeCompositeRange, type AudibleSegment } from './export-audio-composite'
import { contextAt, planWindow, type AudioAnchor, type WindowGate } from './preview-audio-plan'
import { constantSpeedOf, stretchStereo } from './time-stretch'

const SAMPLE_RATE = 48_000
const PACKET_FRAMES = 960

interface FakePacket {
  nominalS: number
  stampS: number
  data: Float32Array<ArrayBuffer>
}

function packetsOf(signal: Float32Array<ArrayBuffer>, jitterS: (index: number) => number): FakePacket[] {
  const packets: FakePacket[] = []
  for (let index = 0; index * PACKET_FRAMES < signal.length; index++) {
    const nominalS = (index * PACKET_FRAMES) / SAMPLE_RATE
    packets.push({ nominalS, stampS: nominalS + jitterS(index), data: signal.slice(index * PACKET_FRAMES, (index + 1) * PACKET_FRAMES) })
  }
  return packets
}

function wrapped(data: Float32Array<ArrayBuffer>, timestamp: number): WrappedAudioBuffer {
  const buffer: AudioBuffer = {
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
    length: data.length,
    duration: data.length / SAMPLE_RATE,
    getChannelData: () => data,
    copyFromChannel: (destination) => destination.set(data.subarray(0, destination.length)),
    copyToChannel: (source) => data.set(source),
  }
  return { buffer, timestamp, duration: buffer.duration }
}

function fakeSink(packets: FakePacket[]): Pick<AudioBufferSink, 'buffers'> {
  return {
    async *buffers(startS = 0, endS = Infinity) {
      let clockS: number | null = null
      for (const packet of packets) {
        const durationS = packet.data.length / SAMPLE_RATE
        if (packet.nominalS + durationS <= startS) continue
        if (packet.nominalS >= endS) return
        // mediabunny times decoded audio from the first sample and accumulates durations, per https://github.com/Vanilagy/mediabunny/blob/main/src/media-sink.ts
        if (clockS === null || Math.abs(packet.stampS - clockS) >= durationS) clockS = packet.stampS
        const stampS = Math.round(clockS * SAMPLE_RATE) / SAMPLE_RATE
        clockS += durationS
        yield wrapped(packet.data, stampS)
      }
    },
  }
}

function gateAt(gate: WindowGate, timeS: number): number {
  if (timeS < gate.openS) return 0
  const opened = gate.fadeInS > 0 ? Math.min(1, (timeS - gate.openS) / gate.fadeInS) : 1
  if (gate.closeS === null || timeS < gate.closeS) return opened
  return gate.fadeOutS > 0 ? opened * Math.max(0, 1 - (timeS - gate.closeS) / gate.fadeOutS) : 0
}

async function previewOf(sink: Pick<AudioBufferSink, 'buffers'>, segment: AudibleSegment, anchor: AudioAnchor): Promise<Float32Array> {
  const startS = contextAt(anchor, Math.max(segment.startMs, anchor.timelineMs))
  const endS = contextAt(anchor, segment.startMs + segment.durationMs)
  const out = new Float32Array(Math.round((endS - startS) * SAMPLE_RATE))
  for (let fromS = startS, index = 0; fromS < endS - 1e-9; fromS += 0.5, index++) {
    const planned = planWindow(segment, anchor, fromS, Math.min(fromS + 0.5, endS), index > 0)
    if (!planned) continue
    const window = planned.segment
    const constant = constantSpeedOf(window.timeMap)
    const decodeFromS = (window.trimStartMs + (constant?.sourceStartOffsetMs ?? 0)) / 1000
    const decoded = await decodeCompositeRange(sink, decodeFromS, (constant?.sourceSpanMs ?? window.sourceSpanMs) / 1000, 'stereo')
    if (decoded.status !== 'ready') throw new Error(`window ${index} decoded ${decoded.status}`)
    const [left = new Float32Array(0), right = left] = decoded.audio.channels
    const heard = constant && Math.abs(constant.rate - 1) > 1e-6 ? (await stretchStereo({ left, right, sampleRate: SAMPLE_RATE }, constant.rate)).left : left
    const originFrame = Math.round((window.startMs / 1000 - startS) * SAMPLE_RATE)
    const frames = Math.min(heard.length, Math.round((window.durationMs / 1000) * SAMPLE_RATE))
    for (let frame = 0; frame < frames; frame++) {
      const at = originFrame + frame
      if (at < 0 || at >= out.length) continue
      out[at] = (out[at] ?? 0) + (heard[frame] ?? 0) * gateAt(planned.gate, startS + at / SAMPLE_RATE)
    }
  }
  return out
}

function tone(seconds: number, hz: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)
  return data
}

function noise(seconds: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  let seed = 7
  let low = 0
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    low += 0.2 * (seed / 1_073_741_824 - 1 - low)
    data[i] = low
  }
  return data
}

function envelopeFloor(signal: Float32Array, fromS: number, toS: number): number {
  const block = Math.round(0.01 * SAMPLE_RATE)
  const levels: number[] = []
  for (let start = Math.round(fromS * SAMPLE_RATE); start + block <= Math.round(toS * SAMPLE_RATE); start += block) {
    let energy = 0
    for (let i = start; i < start + block; i++) energy += (signal[i] ?? 0) ** 2
    levels.push(Math.sqrt(energy / block))
  }
  const sorted = [...levels].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return (sorted[0] ?? 0) / median
}

describe('preview audio window seams', () => {
  const clip: AudibleSegment = { elementId: 'e-1', src: 'blob:a', startMs: 0, durationMs: 4000, trimStartMs: 0, sourceSpanMs: 4000, volume: 1 }

  for (const rate of [1.5, 2, 4]) {
    test(`a 440 Hz tone played at ${rate}x keeps a steady envelope across window seams`, async () => {
      const sink = fakeSink(packetsOf(tone(10, 440), () => 0))
      const segment = { ...clip, durationMs: 2000 * rate, sourceSpanMs: 2000 * rate }
      const heard = await previewOf(sink, segment, { timelineMs: 300 * rate, contextS: 0, rate })
      expect(envelopeFloor(heard, 0.1, heard.length / SAMPLE_RATE - 0.1)).toBeGreaterThan(0.95)
    }, 20_000)
  }

  test('a source with jittered packet timestamps plays the samples a single export decode places', async () => {
    const signal = noise(4)
    const sink = fakeSink(packetsOf(signal, (index) => (index === 0 ? 0 : 0.008 * Math.sin(index * 2.3))))
    const exported = await decodeCompositeRange(sink, 0, clip.durationMs / 1000, 'stereo')
    if (exported.status !== 'ready') throw new Error(`export decoded ${exported.status}`)
    const truth = exported.audio.channels[0] ?? new Float32Array(0)
    const heard = await previewOf(sink, clip, { timelineMs: 0, contextS: 0, rate: 1 })
    let worst = 0
    for (let i = 0; i < heard.length - SAMPLE_RATE * 0.05; i++) worst = Math.max(worst, Math.abs((heard[i] ?? 0) - (truth[i] ?? 0)))
    expect(worst).toBeLessThan(1e-4)
  })
})
