import type { AudioBufferSink, Input } from 'mediabunny'
import type { ElementId, PlaybackState, Project } from '@mcut/timeline'
import { collectAudibleSegments } from './export-audio'
import type { AudibleSegment } from './export-audio-composite'
import { AUDIO_SAMPLE_RATE } from './export-types'
import { inputFor } from './probe'
import { contextAt, epochChange, handoffAnchor, heardContextS, heardTimelineMs, voiceStartS, type AudioAnchor } from './preview-audio-plan'
import { createVoice, dropVoice, equalPower, LOOKAHEAD_S, pumpVoice, retuneVoice, START_LEAD_S, type SinkOf, type Voice } from './preview-audio-voice'
import { sourceAudioSink } from './source-timing'

const MAX_AUDIBLE_RATE = 4
const HANDOFF_LEAD_S = 0.2
const HANDOFF_FADE_S = 0.02
const STOP_LEAD_S = 0.05
const STOP_FADE_S = 0.005
const SUSPEND_IDLE_S = 2

interface OpenSource {
  input: Input
  sink: Pick<AudioBufferSink, 'buffers'>
}

interface KeyedSegment {
  key: string
  volumeKey: string
  segment: AudibleSegment
}

interface Epoch {
  anchor: AudioAnchor
  stage: 'opening' | 'opened' | 'primed'
  output: GainNode
  voices: Map<string, Voice>
  reportedMs: number
}

interface Outgoing {
  epoch: Epoch
  untilS: number | null
}

interface Sounding {
  anchor: AudioAnchor
  outgoing: AudioAnchor | null
}

interface Pause {
  stoppedMs: number
  reportedMs: number
  sounding: Sounding
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

function dueSegments(segments: KeyedSegment[], timelineMs: number, rate: number): KeyedSegment[] {
  const horizonMs = timelineMs + LOOKAHEAD_S * 1000 * rate
  return segments.filter(({ segment }) => segment.startMs < horizonMs && segment.startMs + segment.durationMs > timelineMs)
}

function outputStarted(context: AudioContext): boolean {
  return (context.getOutputTimestamp().performanceTime ?? 0) > 0
}

function heardAt(context: AudioContext, displayTimeMs: number): number | null {
  const { contextTime, performanceTime } = context.getOutputTimestamp()
  return contextTime !== undefined && performanceTime !== undefined && performanceTime > 0
    ? heardContextS({ contextTime, performanceTime }, displayTimeMs)
    : null
}

function crossfade(from: GainNode, to: GainNode, atS: number): void {
  to.gain.value = 0
  to.gain.setValueCurveAtTime(equalPower(true), atS, HANDOFF_FADE_S)
  from.gain.cancelAndHoldAtTime(atS)
  from.gain.setValueCurveAtTime(equalPower(false), atS + 1e-6, HANDOFF_FADE_S)
}

function dropEpoch(epoch: Epoch): void {
  for (const voice of epoch.voices.values()) dropVoice(voice)
  epoch.output.disconnect()
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
  private outgoing: Outgoing | null = null
  private sources = new Map<string, Promise<OpenSource | null>>()
  private audioSources: ReadonlyMap<ElementId, string> | undefined
  private memo: SegmentMemo | null = null
  private outputRendered = false
  private heldMs: number | null = null
  private paused: Pause | null = null
  private stopping: { epochs: Epoch[]; untilS: number } | null = null
  private quietS: number | null = null
  private disposed = false

  setAudioSources(sources: ReadonlyMap<ElementId, string> | undefined): void {
    this.audioSources = sources
  }

  getAudioSources(): ReadonlyMap<ElementId, string> | undefined {
    return this.audioSources
  }

  clockTimeMs(displayTimeMs: number): number | null {
    const { context, epoch } = this
    if (!context || context.state !== 'running') return this.heldMs
    if (!epoch) return this.pausedTimeMs(context, displayTimeMs)
    const sounding = this.soundingAnchors()
    if (!sounding) return epoch.reportedMs
    const heardS = heardAt(context, displayTimeMs) ?? sounding.anchor.contextS
    epoch.reportedMs = Math.max(epoch.reportedMs, heardTimelineMs(sounding.anchor, sounding.outgoing, heardS))
    return epoch.reportedMs
  }

  private pausedTimeMs(context: AudioContext, displayTimeMs: number): number | null {
    const paused = this.paused
    if (!paused) return this.heldMs
    const heardS = heardAt(context, displayTimeMs)
    if (heardS === null) return paused.reportedMs
    const heardMs = heardTimelineMs(paused.sounding.anchor, paused.sounding.outgoing, heardS)
    paused.reportedMs = Math.min(paused.stoppedMs, Math.max(paused.reportedMs, heardMs))
    return paused.reportedMs
  }

  sync(project: Project, requested: PlaybackState): void {
    if (this.disposed) return
    const rate = requested.playbackRate
    if (!requested.isPlaying) {
      this.pause(project, requested)
      return
    }
    this.quietS = null
    if (rate <= 0 || rate > MAX_AUDIBLE_RATE) {
      this.flush()
      return
    }
    const playback = { ...requested, currentTimeMs: this.resumePoint(requested.currentTimeMs) }
    const { context, master } = this.ensureContext()
    master.gain.value = playback.muted ? 0 : playback.volume
    const segments = this.segmentsOf(project)
    if (context.state !== 'running') {
      this.flush()
      if (dueSegments(segments, playback.currentTimeMs, rate).length > 0) this.heldMs = playback.currentTimeMs
      if (context.state === 'suspended') void context.resume()
      return
    }
    this.outputRendered ||= outputStarted(context)
    if (!this.outputRendered && dueSegments(segments, playback.currentTimeMs, rate).length === 0) {
      this.flush()
      return
    }
    const epoch = this.ensureEpoch(context, master, playback, segments)
    if (epoch.stage === 'opened') this.prime(context, epoch)
    const sinkOf: SinkOf = (src) => this.sourceOf(src).then((opened) => opened?.sink ?? null)
    this.settleOutgoing(context, sinkOf)
    if (epoch.stage !== 'primed') return
    this.reconcile(context, epoch, segments)
    for (const voice of epoch.voices.values()) pumpVoice(context, epoch.anchor, voice, sinkOf)
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
    const change =
      current &&
      epochChange({ rate: current.anchor.rate, reportedMs: current.reportedMs, sounding: current.stage === 'primed' || this.outgoing !== null }, playback)
    if (current && change === 'keep') return current
    if (current && change === 'handoff') this.beginHandoff(context, current)
    else this.flush()
    const output = context.createGain()
    output.connect(master)
    const timelineMs = current && change === 'handoff' ? current.reportedMs : Math.round(playback.currentTimeMs)
    const epoch: Epoch = {
      anchor: { timelineMs, contextS: 0, rate: playback.playbackRate },
      stage: 'opening',
      output,
      voices: new Map(),
      reportedMs: timelineMs,
    }
    this.epoch = epoch
    const opening = dueSegments(segments, timelineMs, playback.playbackRate).map(({ segment }) => this.sourceOf(segment.src))
    void Promise.all(opening).then(() => {
      if (this.epoch === epoch) epoch.stage = 'opened'
    })
    return epoch
  }

  private prime(context: AudioContext, epoch: Epoch): void {
    const outgoing = this.outgoing
    const leadS = outgoing ? HANDOFF_LEAD_S : START_LEAD_S
    const atS = (Math.round(context.currentTime * context.sampleRate) + Math.round(leadS * context.sampleRate)) / context.sampleRate
    if (outgoing) {
      epoch.anchor = handoffAnchor(outgoing.epoch.anchor, atS, epoch.anchor.rate)
      crossfade(outgoing.epoch.output, epoch.output, atS)
      outgoing.untilS = atS + HANDOFF_FADE_S
    } else {
      epoch.anchor.contextS = atS
    }
    epoch.stage = 'primed'
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
        epoch.voices.set(key, createVoice(context, epoch.anchor, epoch.output, segment, volumeKey, voiceStartS(epoch.anchor, startS, nowS, START_LEAD_S)))
        continue
      }
      if (voice.volumeKey !== volumeKey) retuneVoice(voice, epoch.anchor, segment, volumeKey, nowS)
    }
    for (const [key, voice] of epoch.voices) {
      if (wanted.has(key)) continue
      dropVoice(voice)
      epoch.voices.delete(key)
    }
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

  private beginHandoff(context: AudioContext, current: Epoch): void {
    this.epoch = null
    const outgoing = this.outgoing
    if (current.stage !== 'primed' || (outgoing && context.currentTime < current.anchor.contextS)) {
      dropEpoch(current)
      if (outgoing && outgoing.untilS !== null) {
        outgoing.untilS = null
        outgoing.epoch.output.gain.cancelScheduledValues(context.currentTime)
        outgoing.epoch.output.gain.setValueAtTime(1, context.currentTime)
      }
      return
    }
    this.dropOutgoing()
    this.outgoing = { epoch: current, untilS: null }
  }

  private soundingAnchors(): Sounding | null {
    const outgoing = this.outgoing?.epoch.anchor ?? null
    const anchor = this.epoch?.stage === 'primed' ? this.epoch.anchor : outgoing
    return anchor ? { anchor, outgoing } : null
  }

  private pause(project: Project, playback: PlaybackState): void {
    const { context } = this
    const sounding = this.soundingAnchors()
    if (context && sounding) this.stop(context, sounding, playback.currentTimeMs)
    else this.dropCurrent()
    if (this.stopping && (!context || context.currentTime > this.stopping.untilS)) this.dropStopping()
    const atMs = this.resumePoint(playback.currentTimeMs)
    const rate = playback.playbackRate
    const audible = rate > 0 && rate <= MAX_AUDIBLE_RATE && dueSegments(this.segmentsOf(project), atMs, rate).length > 0
    this.heldMs = audible ? atMs : null
    if (context) this.suspendWhenQuiet(context)
  }

  private suspendWhenQuiet(context: AudioContext): void {
    if (context.state !== 'running') return
    this.quietS ??= context.currentTime
    const { contextTime, performanceTime } = context.getOutputTimestamp()
    if (contextTime === undefined || !performanceTime || contextTime < this.quietS + SUSPEND_IDLE_S) return
    this.quietS = null
    void context.suspend()
  }

  private stop(context: AudioContext, sounding: Sounding, atMs: number): void {
    const stopS = context.currentTime + STOP_LEAD_S
    this.paused = { stoppedMs: Math.max(atMs, heardTimelineMs(sounding.anchor, sounding.outgoing, stopS)), reportedMs: atMs, sounding }
    const epochs = [this.epoch, this.outgoing?.epoch ?? null].flatMap((epoch) => (epoch ? [epoch] : []))
    for (const epoch of epochs) {
      epoch.output.gain.cancelAndHoldAtTime(stopS)
      epoch.output.gain.setValueCurveAtTime(equalPower(false), stopS + 1e-6, STOP_FADE_S)
    }
    this.dropStopping()
    this.stopping = { epochs, untilS: stopS + STOP_FADE_S }
    this.quietS = stopS + STOP_FADE_S
    this.epoch = null
    this.outgoing = null
  }

  private resumePoint(requestedMs: number): number {
    const paused = this.paused
    if (paused && Math.abs(requestedMs - paused.reportedMs) <= 1) return paused.stoppedMs
    this.paused = null
    return requestedMs
  }

  private settleOutgoing(context: AudioContext, sinkOf: SinkOf): void {
    const outgoing = this.outgoing
    if (!outgoing) return
    if (outgoing.untilS === null) {
      for (const voice of outgoing.epoch.voices.values()) pumpVoice(context, outgoing.epoch.anchor, voice, sinkOf)
    } else if (context.currentTime > outgoing.untilS) {
      this.dropOutgoing()
    }
  }

  private dropOutgoing(): void {
    if (this.outgoing) dropEpoch(this.outgoing.epoch)
    this.outgoing = null
  }

  private dropStopping(): void {
    for (const epoch of this.stopping?.epochs ?? []) dropEpoch(epoch)
    this.stopping = null
  }

  private dropCurrent(): void {
    this.dropOutgoing()
    if (this.epoch) dropEpoch(this.epoch)
    this.epoch = null
  }

  private flush(): void {
    this.heldMs = null
    this.paused = null
    this.dropStopping()
    this.dropCurrent()
  }
}
