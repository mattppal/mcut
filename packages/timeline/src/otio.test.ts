import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject, type Project } from './model'
import { toOtio, toOtioJson } from './otio'

const TRACK = 't-default'

function sampleProject(): Project {
  let project = createProject({ name: 'Sample', fps: 30 })
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-1', kind: 'video', src: 'file:///clip.mp4', name: 'clip.mp4', durationMs: 10_000 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: {
      id: 'e-1',
      type: 'video',
      assetId: 'a-1',
      startMs: 1000,
      durationMs: 2000,
      trimStartMs: 500,
    },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: { id: 'e-2', type: 'video', assetId: 'a-1', startMs: 3000, durationMs: 1000, trimStartMs: 4000 },
  })
  project = applyCommand(project, {
    type: 'setTransition',
    elementId: 'e-1',
    transition: { type: 'dissolve', durationMs: 400 },
  })
  project = applyCommand(project, { type: 'addMarker', id: 'm-1', timeMs: 1500, label: 'beat' })
  return project
}

type O = Record<string, any>

describe('toOtio', () => {
  const otio = toOtio(sampleProject()) as O

  test('produces a Timeline with a top-level Stack of Tracks', () => {
    expect(otio.OTIO_SCHEMA).toBe('Timeline.1')
    expect(otio.tracks.OTIO_SCHEMA).toBe('Stack.1')
    expect(otio.tracks.children).toHaveLength(1)
    expect(otio.tracks.children[0].OTIO_SCHEMA).toBe('Track.1')
  })

  test('leading space becomes a transparent Gap', () => {
    const children = otio.tracks.children[0].children as O[]
    expect(children[0]!.OTIO_SCHEMA).toBe('Gap.1')
    expect(children[0]!.source_range.duration.value).toBe(1000)
  })

  test('clips carry source_range as trim against the media reference', () => {
    const children = otio.tracks.children[0].children as O[]
    const clip = children[1]!
    expect(clip.OTIO_SCHEMA).toBe('Clip.2')
    expect(clip.source_range.start_time).toMatchObject({ rate: 1000, value: 500 })
    expect(clip.source_range.duration.value).toBe(2000)
    const media = clip.media_references.DEFAULT_MEDIA
    expect(media.OTIO_SCHEMA).toBe('ExternalReference.1')
    expect(media.target_url).toBe('file:///clip.mp4')
    expect(media.available_range.duration.value).toBe(10_000)
  })

  test('transitions are zero-footprint items between the pair', () => {
    const children = otio.tracks.children[0].children as O[]
    const transition = children[2]!
    expect(transition.OTIO_SCHEMA).toBe('Transition.1')
    expect(transition.transition_type).toBe('SMPTE_Dissolve')
    expect(transition.in_offset.value).toBe(200)
    expect(transition.out_offset.value).toBe(200)
    // The track's playback length is unaffected: gap 1000 + 2000 + 1000.
    const total = children
      .filter((c) => c.OTIO_SCHEMA !== 'Transition.1')
      .reduce((sum, c) => sum + c.source_range.duration.value, 0)
    expect(total).toBe(4000)
  })

  test('markers attach to the stack', () => {
    expect(otio.tracks.markers).toHaveLength(1)
    expect(otio.tracks.markers[0]!).toMatchObject({ name: 'beat' })
    expect(otio.tracks.markers[0]!.marked_range.start_time.value).toBe(1500)
  })

  test('elements round-trip losslessly through metadata.mcut', () => {
    const children = otio.tracks.children[0].children as O[]
    expect(children[1]!.metadata.mcut.element).toMatchObject({
      id: 'e-1',
      type: 'video',
      trimStartMs: 500,
    })
  })

  test('audio-only tracks export kind Audio', () => {
    let project = sampleProject()
    project = applyCommand(project, { type: 'addTrack', id: 't-audio' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-audio',
      element: { id: 'e-a', type: 'audio', assetId: 'a-1', startMs: 0, durationMs: 1000 },
    })
    const exported = toOtio(project) as O
    expect(exported.tracks.children[1].kind).toBe('Audio')
  })

  test('toOtioJson serializes', () => {
    const parsed = JSON.parse(toOtioJson(sampleProject()))
    expect(parsed.OTIO_SCHEMA).toBe('Timeline.1')
    expect(parsed.metadata.mcut.fps).toBe(30)
  })
})
