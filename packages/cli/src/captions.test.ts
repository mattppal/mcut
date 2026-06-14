import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject } from '@mcut/timeline'
import type { TranscriptResult } from '@mcut/transcription'
import { buildCaptionsCommand } from './captions'

const transcript: TranscriptResult = {
  text: 'hello there world',
  words: [
    { text: 'hello', startMs: 5000, endMs: 5400 },
    { text: 'there', startMs: 5500, endMs: 5900 },
    { text: 'world', startMs: 12000, endMs: 12500 },
  ],
  segments: [],
}

function projectWithClip() {
  const engine = new EditorEngine({ project: createProject({ id: 'p-test' }) })
  engine.dispatch({
    type: 'addAsset',
    asset: { id: 'a-1', kind: 'video', src: 'media/a.mp4', name: 'a.mp4', durationMs: 60000 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-1',
      type: 'video',
      startMs: 2000,
      durationMs: 3000,
      trimStartMs: 4000,
      assetId: 'a-1',
    },
  })
  return engine.project
}

describe('buildCaptionsCommand', () => {
  test('scopes the transcript to an element source window and timeline position', () => {
    const project = projectWithClip()
    const command = buildCaptionsCommand(project, transcript, { elementId: 'e-1' })
    expect(command.type).toBe('applyCaptions')
    const captions = command.captions as Array<{ startMs: number; text: string }>
    // Source window 4000–7000 keeps only the first two words; the clip sits
    // at timeline 2000, so source 5000 lands at 2000 + (5000 - 4000) = 3000.
    expect(captions).toHaveLength(1)
    expect(captions[0]!.text).toBe('hello there')
    expect(captions[0]!.startMs).toBe(3000)

    const engine = new EditorEngine({ project })
    engine.dispatch(command)
    const captionTrack = engine.project.tracks.find((t) =>
      t.elements.some((e) => e.type === 'caption'),
    )
    expect(captionTrack).toBeDefined()
  })

  test('resolves style presets by id and rejects unknown ones', () => {
    const project = projectWithClip()
    const command = buildCaptionsCommand(project, transcript, { styleId: 'karaoke' })
    const captions = command.captions as Array<{ style?: { activeWordColor?: string } }>
    expect(captions[0]!.style?.activeWordColor).toBeDefined()
    expect(() => buildCaptionsCommand(project, transcript, { styleId: 'nope' })).toThrow(/unknown caption style/)
  })
})
