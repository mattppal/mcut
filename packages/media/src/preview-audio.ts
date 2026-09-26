import type { AudioBufferSink, Input } from 'mediabunny'
import type { ElementId, PlaybackState, Project } from '@mcut/timeline'
import { collectAudibleSegments, scheduleSegmentSources } from './export-audio'
import type { AudibleSegment } from './export-audio-composite'
import { AUDIO_SAMPLE_RATE } from './export-types'
import { inputFor } from './probe'
import { contextAt, heardContextS, planWindow, timelineAt, type AudioAnchor, type PlannedWindow, type WindowGate } from './preview-audio-plan'
import { sourceAudioSink } from './source-timing'

const START_LEAD_S = 0.1
const WINDOW_S = 0.5
const LOOKAHEAD_S = 1
const RETRY_S = 1
const MAX_AUDIBLE_RATE = 4
const REANCHOR_TOLERANCE_MS = 1
const VOLUME_SMOOTHING_S = 0.01
const CURVE_STEP_S = 0.05
const MAX_CURVE_STEPS = 2000

interface OpenSource {
  input: Input
  sink: Pick<AudioBufferSink, 'buffers'>
}

interface KeyedSegment {
  key: string
  volumeKey: string
  segment: AudibleSegment
}

interface ScheduledGate {
  node: GainNode
  endS: number
}

interface Voice {
  segment: AudibleSegment
  volumeKey: string
  gain: GainNode
  nextS: number
  planned: number
  busy: boolean
  retryAtS: number
  gates: ScheduledGate[]
  controller: AbortController
}

interface Epoch {
  anchor: AudioAnchor
  primed: boolean
  output: GainNode
  voices: Map<string, Voice>
  reportedMs: number
}

interface SegmentMemo {
  project: Project
  audioSources: ReadonlyMap<ElementId, string> | undefined
  segments: KeyedSegment[]
}

function keyed(segment: AudibleSegment): KeyedSegment {
  const { elementId, src, startMs, durationMs, trimStartMs, sourceSpanMs, reversed, timeMap } = segment
  return {
    key: JSON.stringify([elementId, src, startMs, durationMs, trimStartMs, sourceSpanMs, reversed === true, timeMap ?? null]),
    volumeKey: segment.volumeCurve ? Array.from(segment.volumeCurve).join(',') : String(segment.volume),
    segment,
  }
}

function curveValue(curve: Float32Array, fraction: number): number {
  const position = Math.min(1, Math.max(0, fraction)) * (curve.length - 1)
  const index = Math.floor(position)
  const low = curve[index] ?? 0
  const high = curve[Math.min(curve.length - 1, index + 1)] ?? low
  return low + (high - low) * (position - index)
}

function programVolume(param: AudioParam, anchor: AudioAnchor, segment: AudibleSegment, nowS: number): void {
  param.cancelAndHoldAtTime(nowS)
  const curve = segment.volumeCurve
  if (!curve) {
    param.setTargetAtTime(segment.volume, nowS, VOLUME_SMOOTHING_S)
    return
  }
  const fromS = Math.max(nowS + VOLUME_SMOOTHING_S, contextAt(anchor, segment.startMs))
  const toS = contextAt(anchor, segment.startMs + segment.durationMs)
  if (toS <= fromS) return
  const steps = Math.min(MAX_CURVE_STEPS, Math.max(2, Math.ceil((toS - fromS) / CURVE_STEP_S) + 1))
  const values = new Float32Array(steps)
  for (let step = 0; step < steps; step++) {
    const localMs = timelineAt(anchor, fromS + ((toS - fromS) * step) / (steps - 1)) - segment.startMs
    values[step] = curveValue(curve, localMs / segment.durationMs)
  }
  param.setValueCurveAtTime(values, fromS, toS - fromS)
}

function programGate(param: AudioParam, gate: WindowGate): void {
  param.value = 0
  if (gate.fadeInS > 0) {
    param.setValueAtTime(0, gate.openS)
    param.linearRampToValueAtTime(1, gate.openS + gate.fadeInS)
  } else {
    param.setValueAtTime(1, gate.openS)
  }
  if (gate.closeS === null) return
  param.setValueAtTime(1, gate.closeS)
  param.linearRampToValueAtTime(0, gate.closeS + gate.fadeOutS)
}

async function openSource(src: string): Promise<OpenSource | null> {
  const input = await inputFor(src)
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) {
      input.dispose()
      return null
    }
    return { input, sink: await sourceAudioSink(src, input, track) }
  } catch (error) {
    input.dispose()
    throw error
  }
}

export class PreviewAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private epoch: Epoch | null = null
  private sources = new Map<string, Promise<OpenSource | null>>()
  private audioSources: ReadonlyMap<ElementId, string> | undefined
  private memo: SegmentMemo | null = null
  private disposed = false

  setAudioSources(sources: ReadonlyMap<ElementId, string> | undefined): void {
    this.audioSources = sources
  }

  getAudioSources(): ReadonlyMap<ElementId, string> | undefined {
    return this.audioSources
  }

  clockTimeMs(frameTimeMs: number): number | null {
    const { context, epoch } = this
    if (!context || !epoch || context.state !== 'running') return null
    if (!epoch.primed) return epoch.reportedMs
    const stamp = context.getOutputTimestamp()
    const heardS =
      stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0
        ? heardContextS({ contextTime: stamp.contextTime, performanceTime: stamp.performanceTime }, frameTimeMs)
        : epoch.anchor.contextS
    epoch.reportedMs = Math.max(epoch.reportedMs, timelineAt(epoch.anchor, heardS))
    return epoch.reportedMs
  }

  sync(project: Project, playback: PlaybackState): void {
    if (this.disposed) return
    const rate = playback.playbackRate
    if (!playback.isPlaying || rate <= 0 || rate > MAX_AUDIBLE_RATE) {
      this.flush()
      if (this.context?.state === 'running') void this.context.suspend()
      return
    }
    const { context, master } = this.ensureContext()
    master.gain.value = playback.muted ? 0 : playback.volume
    if (context.state !== 'running') {
      this.flush()
      if (context.state === 'suspended') void context.resume()
      return
    }
    const segments = this.segmentsOf(project)
    const epoch = this.ensureEpoch(context, master, playback, segments)
    if (!epoch.primed) return
    this.reconcile(context, epoch, segments)
    for (const voice of epoch.voices.values()) this.pump(context, epoch, voice)
  }

  dispose(): void {
    this.disposed = true
    this.flush()
    for (const source of this.sources.values()) void source.then((opened) => opened?.input.dispose())
    this.sources.clear()
    void this.context?.close()
    this.context = null
    this.master = null
  }

  private ensureContext(): { context: AudioContext; master: GainNode } {
    if (this.context && this.master) return { context: this.context, master: this.master }
    const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
    const master = context.createGain()
    master.connect(context.destination)
    this.context = context
    this.master = master
    return { context, master }
  }

  private ensureEpoch(context: AudioContext, master: GainNode, playback: PlaybackState, segments: KeyedSegment[]): Epoch {
    const current = this.epoch
    if (current && current.anchor.rate === playback.playbackRate && Math.abs(playback.currentTimeMs - current.reportedMs) <= REANCHOR_TOLERANCE_MS) return current
    this.flush()
    const output = context.createGain()
    output.connect(master)
    const timelineMs = Math.round(playback.currentTimeMs)
    const epoch: Epoch = {
      anchor: { timelineMs, contextS: 0, rate: playback.playbackRate },
      primed: false,
      output,
      voices: new Map(),
      reportedMs: timelineMs,
    }
    this.epoch = epoch
    const horizonMs = timelineMs + LOOKAHEAD_S * 1000 * playback.playbackRate
    const opening = segments
      .filter(({ segment }) => segment.startMs < horizonMs && segment.startMs + segment.durationMs > timelineMs)
      .map(({ segment }) => this.sourceOf(segment.src))
    void Promise.all(opening).then(() => {
      if (this.epoch !== epoch || !this.context) return
      const frames = Math.round(this.context.currentTime * this.context.sampleRate) + Math.round(START_LEAD_S * this.context.sampleRate)
      epoch.anchor.contextS = frames / this.context.sampleRate
      epoch.primed = true
    })
    return epoch
  }

  private segmentsOf(project: Project): KeyedSegment[] {
    const memo = this.memo
    if (memo && memo.project === project && memo.audioSources === this.audioSources) return memo.segments
    const segments = collectAudibleSegments(project, this.audioSources).map(keyed)
    this.memo = { project, audioSources: this.audioSources, segments }
    const used = new Set(segments.map(({ segment }) => segment.src))
    for (const [src, source] of this.sources) {
      if (used.has(src)) continue
      this.sources.delete(src)
      void source.then((opened) => opened?.input.dispose())
    }
    return segments
  }

  private reconcile(context: AudioContext, epoch: Epoch, segments: KeyedSegment[]): void {
    const nowS = context.currentTime
    const wanted = new Set<string>()
    for (const { key, volumeKey, segment } of segments) {
      const startS = contextAt(epoch.anchor, segment.startMs)
      const endS = contextAt(epoch.anchor, segment.startMs + segment.durationMs)
      if (startS > nowS + LOOKAHEAD_S || endS <= Math.max(nowS, epoch.anchor.contextS)) continue
      wanted.add(key)
      const voice = epoch.voices.get(key)
      if (!voice) {
        epoch.voices.set(key, this.createVoice(context, epoch, segment, volumeKey, Math.max(startS, nowS + START_LEAD_S, epoch.anchor.contextS)))
      } else if (voice.volumeKey !== volumeKey) {
        voice.segment = segment
        voice.volumeKey = volumeKey
        programVolume(voice.gain.gain, epoch.anchor, segment, nowS)
      }
    }
    for (const [key, voice] of epoch.voices) {
      if (wanted.has(key)) continue
      this.dropVoice(voice)
      epoch.voices.delete(key)
    }
  }

  private createVoice(context: AudioContext, epoch: Epoch, segment: AudibleSegment, volumeKey: string, nextS: number): Voice {
    const gain = context.createGain()
    gain.gain.value = segment.volumeCurve ? 0 : segment.volume
    programVolume(gain.gain, epoch.anchor, segment, context.currentTime)
    gain.connect(epoch.output)
    return { segment, volumeKey, gain, nextS, planned: 0, busy: false, retryAtS: 0, gates: [], controller: new AbortController() }
  }

  private dropVoice(voice: Voice): void {
    voice.controller.abort()
    voice.gain.disconnect()
    for (const gate of voice.gates) gate.node.disconnect()
    voice.gates = []
  }

  private pump(context: AudioContext, epoch: Epoch, voice: Voice): void {
    const nowS = context.currentTime
    voice.gates = voice.gates.filter((gate) => {
      if (gate.endS >= nowS) return true
      gate.node.disconnect()
      return false
    })
    if (voice.busy || nowS < voice.retryAtS || voice.nextS > nowS + LOOKAHEAD_S) return
    const endS = contextAt(epoch.anchor, voice.segment.startMs + voice.segment.durationMs)
    if (voice.nextS >= endS - 1e-6) return
    const fromS = voice.nextS
    const toS = Math.min(fromS + WINDOW_S, endS)
    voice.nextS = toS
    const planned = planWindow(voice.segment, epoch.anchor, fromS, toS, voice.planned > 0)
    if (!planned) return
    voice.planned++
    voice.busy = true
    this.render(context, voice, planned)
      .catch(() => {
        if (!voice.controller.signal.aborted) voice.retryAtS = context.currentTime + RETRY_S
      })
      .finally(() => {
        voice.busy = false
      })
  }

  private async render(context: AudioContext, voice: Voice, planned: PlannedWindow): Promise<void> {
    const source = await this.sourceOf(planned.segment.src)
    const signal = voice.controller.signal
    if (!source || signal.aborted) return
    const gate = context.createGain()
    programGate(gate.gain, planned.gate)
    gate.connect(voice.gain)
    voice.gates.push({ node: gate, endS: planned.endS })
    await scheduleSegmentSources(context, gate, source.sink, planned.segment, signal)
  }

  private sourceOf(src: string): Promise<OpenSource | null> {
    const cached = this.sources.get(src)
    if (cached) return cached
    const opening = openSource(src).catch(() => {
      this.sources.delete(src)
      return null
    })
    this.sources.set(src, opening)
    return opening
  }

  private flush(): void {
    const epoch = this.epoch
    if (!epoch) return
    for (const voice of epoch.voices.values()) this.dropVoice(voice)
    epoch.output.disconnect()
    this.epoch = null
  }
}
