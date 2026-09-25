import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, type TimelineElement } from '@mcut/timeline'
import type { TranscriptResult } from './types'
import { buildCaptionsCommand } from './captions'

const transcript: TranscriptResult = {
  text: 'hello there world',
  words: [
    { text: 'hello', startMs: 2000, endMs: 2400 },
    { text: 'there', startMs: 8000, endMs: 8400 },
    { text: 'world', startMs: 12000, endMs: 12400 },
  ],
  segments: [],
}

function multicamProject(): EditorEngine {
  const engine = new EditorEngine({ project: createProject({ id: 'p-cap' }) })
  engine.dispatch({ type: 'addTrack', id: 't-mic' })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'media/screen.mp4', durationMs: 60000 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'media/mic.wav', durationMs: 60000 } })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 2000, durationMs: 8000, trimStartMs: 0 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-mic',
    element: { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 2000, durationMs: 8000, trimStartMs: 1500 },
  })
  engine.dispatch({
    type: 'createMulticam',
    sources: [{ elementId: 'e-screen' }, { elementId: 'e-mic' }],
    multicamId: 'e-mc',
  })
  return engine
}

function captionTimes(elements: readonly TimelineElement[]) {
  return elements.flatMap((element) => (element.type === 'caption' ? [{ text: element.text, startMs: element.startMs, durationMs: element.durationMs }] : []))
}

describe('buildCaptionsCommand', () => {
  test('scopes captions to a multicam audio source with a non-zero offset', () => {
    const engine = multicamProject()
    const command = buildCaptionsCommand(engine.project, transcript, { elementId: 'e-mc' })
    engine.dispatch(command)
    const captions = engine.project.tracks.flatMap((track) => track.elements)
    expect(captionTimes(captions)).toEqual([
      { text: 'hello', startMs: 2500, durationMs: 400 },
      { text: 'there', startMs: 8500, durationMs: 400 },
    ])
  })

  test('a multicam with no audio source points at setMulticamAudio', () => {
    const engine = multicamProject()
    engine.dispatch({ type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })
    expect(() => buildCaptionsCommand(engine.project, transcript, { elementId: 'e-mc' })).toThrow(
      'element "e-mc" has no audio source; set one with setMulticamAudio',
    )
  })

  test('a text element is not a caption scope', () => {
    const engine = new EditorEngine({ project: createProject({ id: 'p-text' }) })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-title', type: 'text', startMs: 0, durationMs: 1000, text: 'Title' },
    })
    expect(() => buildCaptionsCommand(engine.project, transcript, { elementId: 'e-title' })).toThrow('captions scope to a clip with source audio, not "text"')
  })
})
