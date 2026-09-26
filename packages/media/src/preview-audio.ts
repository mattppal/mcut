import type { AudioBufferSink, Input } from 'mediabunny'
import type { ElementId, PlaybackState, Project } from '@mcut/timeline'
import { collectAudibleSegments } from './export-audio'
import type { AudibleSegment } from './export-audio-composite'
import { AUDIO_SAMPLE_RATE } from './export-types'
import { inputFor } from './probe'
import { contextAt, epochChange, heardContextS, timelineAt, type AudioAnchor } from './preview-audio-plan'
import { createVoice, dropVoice, LOOKAHEAD_S, pumpVoice, retuneVoice, START_LEAD_S, type Voice } from './preview-audio-voice'
import { sourceAudioSink } from './source-timing'

const MAX_AUDIBLE_RATE = 4

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

  clockTimeMs(displayTimeMs: number): number | null {
    const { context, epoch } = this
    if (!context || !epoch || context.state !== 'running') return null
    if (!epoch.primed) return epoch.reportedMs
    const stamp = context.getOutputTimestamp()
    const heardS =
      stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0
        ? heardContextS({ contextTime: stamp.contextTime, performanceTime: stamp.performanceTime }, displayTimeMs)
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
    const sinkOf = (src: string) => this.sourceOf(src).then((opened) => opened?.sink ?? null)
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
    if (current && epochChange({ rate: current.anchor.rate, reportedMs: current.reportedMs }, playback) === 'keep') return current
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
        epoch.voices.set(
          key,
          createVoice(context, epoch.anchor, epoch.output, segment, volumeKey, Math.max(startS, nowS + START_LEAD_S, epoch.anchor.contextS)),
        )
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

  private flush(): void {
    const epoch = this.epoch
    if (!epoch) return
    for (const voice of epoch.voices.values()) dropVoice(voice)
    epoch.output.disconnect()
    this.epoch = null
  }
}
