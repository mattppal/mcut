import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type PlaybackState } from '@mcut/timeline'
import { PreviewAudio } from './preview-audio'

const output = { contextTime: 0, performanceTime: 0 }
let renderedS = 0.013

class StalledAudioContext {
  state = 'running'
  sampleRate = 48_000
  destination = {}

  get currentTime(): number {
    return renderedS
  }

  createGain() {
    return { gain: { value: 1, cancelAndHoldAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }
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

const playing = (currentTimeMs: number): PlaybackState => ({ currentTimeMs, isPlaying: true, playbackRate: 1, volume: 1, muted: false })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('preview audio clock around the output start', () => {
  let audio: PreviewAudio

  beforeEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', { value: StalledAudioContext, configurable: true, writable: true })
    output.contextTime = 0
    output.performanceTime = 0
    renderedS = 0.013
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
    let project = applyCommand(createProject(), { type: 'addAsset', asset: { id: 'a-tone', kind: 'audio', src: 'blob:tone', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addElement', trackId: 't-default', element: { type: 'audio', id: 'e-tone', assetId: 'a-tone', startMs: 0, durationMs: 5000 } })
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
})
