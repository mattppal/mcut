import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type PlaybackState } from '@mcut/timeline'
import { PreviewAudio } from './preview-audio'

const output = { contextTime: 0, performanceTime: 0 }
let renderedS = 0.013

class RecordingGain {
  disconnected = false
  curveStarts: number[] = []
  gain = {
    value: 1,
    cancelAndHoldAtTime() {},
    cancelScheduledValues() {},
    setValueAtTime() {},
    setTargetAtTime() {},
    setValueCurveAtTime: (_values: Float32Array, startS: number) => {
      this.curveStarts.push(startS)
    },
  }

  connect() {}

  disconnect() {
    this.disconnected = true
  }
}

let gains: RecordingGain[] = []

class StalledAudioContext {
  state = 'running'
  sampleRate = 48_000
  destination = {}

  get currentTime(): number {
    return renderedS
  }

  createGain() {
    const gain = new RecordingGain()
    gains.push(gain)
    return gain
  }

  getOutputTimestamp() {
    return { ...output }
  }

  resume() {
    return Promise.resolve()
  }

  suspend() {
    return Promise.resolve()
  }

  close() {
    return Promise.resolve()
  }
}

const playing = (currentTimeMs: number, playbackRate = 1): PlaybackState => ({ currentTimeMs, isPlaying: true, playbackRate, volume: 1, muted: false })

function toneProject() {
  const project = applyCommand(createProject(), { type: 'addAsset', asset: { id: 'a-tone', kind: 'audio', src: 'data:,', durationMs: 60_000 } })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: { type: 'audio', id: 'e-tone', assetId: 'a-tone', startMs: 0, durationMs: 5000 },
  })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('preview audio clock around the output start', () => {
  let audio: PreviewAudio

  beforeEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', { value: StalledAudioContext, configurable: true, writable: true })
    output.contextTime = 0
    output.performanceTime = 0
    renderedS = 0.013
    gains = []
    audio = new PreviewAudio()
  })

  afterEach(() => {
    audio.dispose()
    Reflect.deleteProperty(globalThis, 'AudioContext')
  })

  test('a running context whose output has not started leaves the playhead on the wall clock', async () => {
    const project = createProject()
    audio.sync(project, playing(1000))
    await settle()
    audio.sync(project, playing(1016))
    expect(audio.clockTimeMs(116)).toBeNull()
  })

  test('a running context whose output has not started holds the playhead at the play position while sound is due', async () => {
    const project = toneProject()
    audio.sync(project, playing(1000))
    await settle()
    audio.sync(project, playing(1000))
    expect(audio.clockTimeMs(116)).toBe(1000)
  })

  test('the clock anchors where the playhead is once the output starts', async () => {
    const project = createProject()
    audio.sync(project, playing(1000))
    await settle()
    renderedS = 0.5
    output.contextTime = 0.5
    output.performanceTime = 100
    audio.sync(project, playing(1400))
    await settle()
    audio.sync(project, playing(1400))
    expect(audio.clockTimeMs(116)).toBe(1400)
  })

  test('a resume after the output has rendered once anchors without waiting for a fresh output timestamp', async () => {
    const project = createProject()
    renderedS = 0.5
    output.contextTime = 0.5
    output.performanceTime = 100
    audio.sync(project, playing(1000))
    await settle()
    audio.sync(project, { ...playing(2000), isPlaying: false })
    output.performanceTime = 0
    audio.sync(project, playing(2000))
    await settle()
    audio.sync(project, playing(2000))
    expect(audio.clockTimeMs(116)).toBe(2000)
  })

  test('a second rate change before the first handoff sounds keeps the sounding epoch and hands off from it', async () => {
    const project = toneProject()
    renderedS = 0.5
    output.contextTime = 0.5
    output.performanceTime = 100
    audio.sync(project, playing(1000))
    await settle()
    audio.sync(project, playing(1000))
    const sounding = gains[1]
    renderedS = 1
    audio.sync(project, playing(1000, 2))
    await settle()
    renderedS = 1.05
    audio.sync(project, playing(1000, 4))
    await settle()
    audio.sync(project, playing(1000, 4))
    expect(sounding?.disconnected).toBe(false)
    expect(sounding?.curveStarts.at(-1)).toBeCloseTo(1.25, 3)
  })
})
