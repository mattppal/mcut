import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError, listCommands, listToolDefinitions } from './commands'
import { createProject, type CaptionElement, type Project, type VideoElement } from './model'
import { findNearestFreeSlot, getElement, getProjectDurationMs, getTrack } from './selectors'

function projectWithVideo(): { project: Project; trackId: `t-${string}` } {
  let project = createProject({ name: 'test' })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000 },
  })
  return { project, trackId }
}

describe('track commands', () => {
  test('addTrack appends and inserts at index', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'addTrack', name: 'Overlay' })
    expect(project.tracks.map((t) => t.name)).toEqual(['Track 1', 'Overlay'])
    project = applyCommand(project, { type: 'addTrack', name: 'Background', index: 0 })
    expect(project.tracks.map((t) => t.name)).toEqual(['Background', 'Track 1', 'Overlay'])
  })

  test('addTrack inherits active timeline magnet mode', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'setTrackFlags', trackId, magnetic: true })
    project = applyCommand(project, { type: 'addTrack', name: 'Captions' })
    expect(project.tracks.map((track) => track.magnetic)).toEqual([true, true])
  })

  test('reorderTrack moves a track', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'addTrack', name: 'B' })
    const first = project.tracks[0]!.id
    project = applyCommand(project, { type: 'reorderTrack', trackId: first, toIndex: 1 })
    expect(project.tracks[1]!.id).toBe(first)
  })

  test('removeTrack drops the track', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'removeTrack', trackId })
    expect(project.tracks).toHaveLength(0)
  })

  test('setTrackFlags updates flags', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'setTrackFlags', trackId, muted: true, hidden: true, magnetic: true })
    expect(getTrack(project, trackId)).toMatchObject({ muted: true, hidden: true, locked: false, magnetic: true })
  })

  test('compactTrackGaps closes gaps without enabling magnet mode', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    for (const [id, startMs] of [['e-a', 1000], ['e-b', 4000]] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId,
        element: { id, type: 'text', startMs, durationMs: 1000, text: id },
      })
    }

    const next = applyCommand(project, { type: 'compactTrackGaps', trackId })
    expect(getTrack(next, trackId)).toMatchObject({ magnetic: false })
    expect(getTrack(next, trackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
  })

  test('compactTimelineGaps closes gaps on every track without enabling magnet mode', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'addTrack', name: 'Captions' })
    const captionTrackId = project.tracks[1]!.id

    for (const [targetTrackId, id, startMs] of [
      [trackId, 'e-a', 1000],
      [trackId, 'e-b', 4000],
      [captionTrackId, 'e-caption-a', 2000],
      [captionTrackId, 'e-caption-b', 6000],
    ] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId: targetTrackId,
        element: { id, type: 'text', startMs, durationMs: 1000, text: id },
      })
    }

    const next = applyCommand(project, { type: 'compactTimelineGaps' })
    expect(next.tracks.map((track) => track.magnetic)).toEqual([false, false])
    expect(getTrack(next, trackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
    expect(getTrack(next, captionTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-caption-a', 0],
      ['e-caption-b', 1000],
    ])
  })

  test('enabling magnet mode immediately compacts every track', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'addTrack', name: 'Captions' })
    const captionTrackId = project.tracks[1]!.id

    for (const [targetTrackId, id, startMs] of [
      [trackId, 'e-a', 1000],
      [trackId, 'e-b', 4000],
      [captionTrackId, 'e-caption-a', 2000],
      [captionTrackId, 'e-caption-b', 6000],
    ] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId: targetTrackId,
        element: { id, type: 'text', startMs, durationMs: 1000, text: id },
      })
    }

    const next = applyCommand(project, { type: 'setTrackFlags', trackId, magnetic: true })
    expect(getTrack(next, trackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
    expect(getTrack(next, captionTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-caption-a', 0],
      ['e-caption-b', 1000],
    ])
  })
})

describe('element commands', () => {
  test('addElement fills defaults, generates ids, keeps sort order', () => {
    const { project, trackId } = projectWithVideo()
    let next = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', assetId: 'a-vid', startMs: 5000, durationMs: 2000 },
    })
    next = applyCommand(next, {
      type: 'addElement',
      trackId,
      element: { type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    const elements = getTrack(next, trackId)!.elements
    expect(elements.map((e) => e.startMs)).toEqual([0, 5000])
    const video = elements[0] as VideoElement
    expect(video.id.startsWith('e-')).toBe(true)
    expect(video.opacity).toBe(1)
    expect(video.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  })

  test('addElement rejects overlap and unknown assets', () => {
    const { project, trackId } = projectWithVideo()
    const next = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    expect(() =>
      applyCommand(next, {
        type: 'addElement',
        trackId,
        element: { type: 'video', assetId: 'a-vid', startMs: 1000, durationMs: 2000 },
      }),
    ).toThrow(CommandError)
    expect(() =>
      applyCommand(next, {
        type: 'addElement',
        trackId,
        element: { type: 'video', assetId: 'a-missing', startMs: 4000, durationMs: 1000 },
      }),
    ).toThrow('no asset')
  })

  test('addElement rejects playing past the asset end', () => {
    const { project, trackId } = projectWithVideo()
    expect(() =>
      applyCommand(project, {
        type: 'addElement',
        trackId,
        element: {
          type: 'video',
          assetId: 'a-vid',
          startMs: 0,
          durationMs: 8000,
          trimStartMs: 5000,
        },
      }),
    ).toThrow('plays past the end')
  })

  test('moveElement moves across tracks and rejects overlap', () => {
    let { project, trackId } = projectWithVideo()
    project = applyCommand(project, { type: 'addTrack', name: 'B' })
    const trackB = project.tracks[1]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-one', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: trackB,
      element: { id: 'e-two', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    const moved = applyCommand(project, {
      type: 'moveElement',
      elementId: 'e-one',
      startMs: 3000,
      toTrackId: trackB,
    })
    expect(getTrack(moved, trackId)!.elements).toHaveLength(0)
    expect(getTrack(moved, trackB)!.elements.map((e) => e.id)).toEqual(['e-two', 'e-one'])
    expect(() =>
      applyCommand(project, { type: 'moveElement', elementId: 'e-one', startMs: 1000, toTrackId: trackB }),
    ).toThrow('overlap')
  })

  test('trimElement updates timing within asset bounds', () => {
    let { project, trackId } = projectWithVideo()
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-one', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 4000 },
    })
    const trimmed = applyCommand(project, {
      type: 'trimElement',
      elementId: 'e-one',
      startMs: 500,
      durationMs: 3000,
      trimStartMs: 1000,
    })
    expect(getElement(trimmed, 'e-one')).toMatchObject({
      startMs: 500,
      durationMs: 3000,
      trimStartMs: 1000,
    })
    expect(() =>
      applyCommand(project, { type: 'trimElement', elementId: 'e-one', durationMs: 11_000 }),
    ).toThrow('plays past the end')
  })

  test('magnetic tracks compact after remove, trim, and cross-track moves', () => {
    let project = createProject()
    const sourceTrackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'addTrack', name: 'Target' })
    const targetTrackId = project.tracks[1]!.id

    for (const [trackId, id, startMs] of [
      [sourceTrackId, 'e-a', 0],
      [sourceTrackId, 'e-b', 3000],
      [sourceTrackId, 'e-c', 6000],
      [targetTrackId, 'e-x', 5000],
    ] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId,
        element: { id, type: 'text', startMs, durationMs: 1000, text: id },
      })
    }
    project = applyCommand(project, { type: 'setTrackFlags', trackId: sourceTrackId, magnetic: true })
    project = applyCommand(project, { type: 'setTrackFlags', trackId: targetTrackId, magnetic: true })

    project = applyCommand(project, { type: 'removeElement', elementId: 'e-b' })
    expect(getTrack(project, sourceTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
      ['e-c', 1000],
    ])

    project = applyCommand(project, { type: 'trimElement', elementId: 'e-a', durationMs: 500 })
    expect(getTrack(project, sourceTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
      ['e-c', 500],
    ])

    project = applyCommand(project, {
      type: 'moveElement',
      elementId: 'e-c',
      startMs: 4000,
      toTrackId: targetTrackId,
    })
    expect(getTrack(project, sourceTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-a', 0],
    ])
    expect(getTrack(project, targetTrackId)!.elements.map((e) => [e.id, e.startMs])).toEqual([
      ['e-x', 0],
      ['e-c', 1000],
    ])
  })

  test('splitElement splits media with trim offset', () => {
    let { project, trackId } = projectWithVideo()
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: {
        id: 'e-one',
        type: 'video',
        assetId: 'a-vid',
        startMs: 1000,
        durationMs: 4000,
        trimStartMs: 500,
      },
    })
    const split = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-one',
      atMs: 2500,
      rightElementId: 'e-right',
    })
    const elements = getTrack(split, trackId)!.elements as VideoElement[]
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({ id: 'e-one', startMs: 1000, durationMs: 1500, trimStartMs: 500 })
    expect(elements[1]).toMatchObject({ id: 'e-right', startMs: 2500, durationMs: 2500, trimStartMs: 2000 })
  })

  test('splitElement partitions caption words relative to each half', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: {
        id: 'e-cap',
        type: 'caption',
        startMs: 0,
        durationMs: 2000,
        text: 'hello brave world',
        words: [
          { text: 'hello', startMs: 0, endMs: 400 },
          { text: 'brave', startMs: 500, endMs: 900 },
          { text: 'world', startMs: 1200, endMs: 1600 },
        ],
      },
    })
    const split = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-cap',
      atMs: 1000,
      rightElementId: 'e-cap2',
    })
    const [left, right] = getTrack(split, trackId)!.elements as CaptionElement[]
    expect(left!.words!.map((w) => w.text)).toEqual(['hello', 'brave'])
    expect(left!.text).toBe('hello brave')
    expect(right!.words).toEqual([{ text: 'world', startMs: 200, endMs: 600 }])
    expect(right!.text).toBe('world')
  })

  test('updateElement validates the merged element', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-text', type: 'text', startMs: 0, durationMs: 1000, text: 'hi' },
    })
    const updated = applyCommand(project, {
      type: 'updateElement',
      elementId: 'e-text',
      patch: { text: 'hello', opacity: 0.5, box: { width: 320 } },
    })
    expect(getElement(updated, 'e-text')).toMatchObject({
      text: 'hello',
      opacity: 0.5,
      box: { width: 320, overflow: 'clip' },
    })
    expect(() =>
      applyCommand(project, { type: 'updateElement', elementId: 'e-text', patch: { opacity: 9 } }),
    ).toThrow('invalid element')
    expect(() =>
      applyCommand(project, { type: 'updateElement', elementId: 'e-text', patch: { box: { width: 0 } } }),
    ).toThrow('invalid element')
    expect(() =>
      applyCommand(project, { type: 'updateElement', elementId: 'e-text', patch: { type: 'image' } }),
    ).toThrow('may not change')
  })

  test('removeAsset cascades to elements', () => {
    let { project, trackId } = projectWithVideo()
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', startMs: 2000, durationMs: 1000, text: 'keep me' },
    })
    const next = applyCommand(project, { type: 'removeAsset', assetId: 'a-vid' })
    expect(next.assets['a-vid']).toBeUndefined()
    expect(getTrack(next, trackId)!.elements.map((e) => e.type)).toEqual(['text'])
  })
})

describe('applyCaptions', () => {
  test('creates a captions track and replaces existing captions', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'applyCaptions',
      captions: [
        { startMs: 0, durationMs: 1000, text: 'one' },
        { startMs: 1000, durationMs: 1000, text: 'two' },
      ],
    })
    expect(project.tracks.map((t) => t.name)).toEqual(['Track 1', 'Captions'])
    expect(project.tracks[1]!.elements).toHaveLength(2)

    // Re-applying replaces instead of stacking.
    project = applyCommand(project, {
      type: 'applyCaptions',
      captions: [{ startMs: 0, durationMs: 500, text: 'replaced' }],
    })
    expect(project.tracks).toHaveLength(2)
    expect(project.tracks[1]!.elements).toHaveLength(1)
    expect(project.tracks[1]!.elements[0]).toMatchObject({ type: 'caption', text: 'replaced' })
  })
})

describe('selectors', () => {
  test('getProjectDurationMs and findNearestFreeSlot', () => {
    let { project, trackId } = projectWithVideo()
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', assetId: 'a-vid', startMs: 1000, durationMs: 2000 },
    })
    expect(getProjectDurationMs(project)).toBe(3000)
    const track = getTrack(project, trackId)!
    // Desired position overlaps; nearest free slot is flush after the clip.
    expect(findNearestFreeSlot(track, 2000, 1000)).toBe(3000)
    expect(findNearestFreeSlot(track, 4000, 1000)).toBe(4000)
    // Fits exactly before the clip.
    expect(findNearestFreeSlot(track, 500, 1000)).toBe(0)
  })

  test('unknown command type throws', () => {
    const project = createProject()
    expect(() => applyCommand(project, { type: 'nope' })).toThrow('unknown command')
  })
})

describe('detachAudio', () => {
  function projectWithPlacedVideo() {
    const { project, trackId } = projectWithVideo()
    const next = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: {
        type: 'video',
        id: 'e-vid',
        assetId: 'a-vid',
        startMs: 1000,
        durationMs: 4000,
        trimStartMs: 500,
        volume: 1.5,
        keyframes: {
          volume: [
            { timeMs: 0, value: 0 },
            { timeMs: 1000, value: 1.5 },
          ],
          opacity: [{ timeMs: 0, value: 1 }],
        },
      },
    })
    return { project: next, trackId }
  }

  test('creates a linked audio element on a new bottom track', () => {
    const { project, trackId } = projectWithPlacedVideo()
    const next = applyCommand(project, { type: 'detachAudio', elementId: 'e-vid' })

    expect(next.tracks).toHaveLength(2)
    const audioTrack = next.tracks[0]!
    expect(audioTrack.name).toBe('Audio')
    expect(audioTrack.elements).toHaveLength(1)

    const audio = audioTrack.elements[0]!
    expect(audio.type).toBe('audio')
    expect(audio).toMatchObject({
      startMs: 1000,
      durationMs: 4000,
      trimStartMs: 500,
      assetId: 'a-vid',
      volume: 1.5,
      muted: false,
    })
    // Volume keyframes move to the audio element.
    expect(audio.keyframes?.volume).toHaveLength(2)

    const video = getElement(next, 'e-vid' as `e-${string}`)! as VideoElement
    expect(video.muted).toBe(true)
    expect(video.keyframes?.volume).toBeUndefined()
    expect(video.keyframes?.opacity).toHaveLength(1)
    expect(video.linkId).toBeDefined()
    expect(audio.linkId).toBe(video.linkId)
    expect(getTrack(next, trackId)).toBeDefined()
  })

  test('respects toTrackId and rejects overlap there', () => {
    const { project } = projectWithPlacedVideo()
    let next = applyCommand(project, { type: 'addTrack', name: 'Music' })
    const musicTrackId = next.tracks[1]!.id
    next = applyCommand(next, { type: 'detachAudio', elementId: 'e-vid', toTrackId: musicTrackId })
    expect(next.tracks).toHaveLength(2)
    expect(getTrack(next, musicTrackId)!.elements[0]!.type).toBe('audio')
    // Detaching again: video is now muted.
    expect(() => applyCommand(next, { type: 'detachAudio', elementId: 'e-vid' })).toThrow(CommandError)
  })

  test('rejects non-video elements', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-txt', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    expect(() => applyCommand(project, { type: 'detachAudio', elementId: 'e-txt' })).toThrow(
      CommandError,
    )
  })
})

describe('flips (negative scale)', () => {
  test('updateElement accepts negative scale and rejects zero', () => {
    const { project, trackId } = projectWithVideo()
    let next = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', id: 'e-flip', assetId: 'a-vid', startMs: 0, durationMs: 1000 },
    })
    next = applyCommand(next, {
      type: 'updateElement',
      elementId: 'e-flip',
      patch: { transform: { x: 0, y: 0, scaleX: -1, scaleY: 1, rotation: 0 } },
    })
    const video = getElement(next, 'e-flip' as `e-${string}`) as VideoElement
    expect(video.transform.scaleX).toBe(-1)
    expect(() =>
      applyCommand(next, {
        type: 'updateElement',
        elementId: 'e-flip',
        patch: { transform: { x: 0, y: 0, scaleX: 0, scaleY: 1, rotation: 0 } },
      }),
    ).toThrow(CommandError)
  })
})

describe('magnetic tracks', () => {
  function magneticProject(): { project: Project; trackId: `t-${string}` } {
    let project = createProject({ name: 'magnet' })
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'setTrackFlags', trackId, magnetic: true })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-a', text: 'A', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-b', text: 'B', startMs: 5000, durationMs: 400 },
    })
    return { project, trackId }
  }

  const order = (p: Project, trackId: string) =>
    p.tracks.find((t) => t.id === trackId)!.elements.map((e) => [e.id, e.startMs])

  test('adding clips packs them with no gaps', () => {
    const { project, trackId } = magneticProject()
    expect(order(project, trackId)).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
  })

  test('enabling the magnet compacts existing gaps', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-x', text: 'x', startMs: 3000, durationMs: 500 },
    })
    project = applyCommand(project, { type: 'setTrackFlags', trackId, magnetic: true })
    expect(order(project, trackId)).toEqual([['e-x', 0]])
  })

  test('moving past the neighbor midpoint reorders; short drags do not', () => {
    const { project, trackId } = magneticProject()
    // Threshold: A swaps when its RIGHT edge passes B's visible midpoint
    // (1000 + 200) — i.e. startMs ≥ 200. A short nudge stays put.
    const same = applyCommand(project, { type: 'moveElement', elementId: 'e-a', startMs: 100 })
    expect(order(same, trackId)).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
    // Past it: reorder to B, A — and packed.
    const swapped = applyCommand(project, { type: 'moveElement', elementId: 'e-a', startMs: 300 })
    expect(order(swapped, trackId)).toEqual([
      ['e-b', 0],
      ['e-a', 400],
    ])
    // And back (reversible mid-gesture): the threshold is unchanged after the
    // swap (B's packed midpoint is 200), so the same pointer travel undoes it.
    const restored = applyCommand(swapped, { type: 'moveElement', elementId: 'e-a', startMs: 100 })
    expect(order(restored, trackId)).toEqual([
      ['e-a', 0],
      ['e-b', 1000],
    ])
  })

  test('trim ripples downstream clips instead of overlapping', () => {
    const { project, trackId } = magneticProject()
    const grown = applyCommand(project, { type: 'trimElement', elementId: 'e-a', durationMs: 2500 })
    expect(order(grown, trackId)).toEqual([
      ['e-a', 0],
      ['e-b', 2500],
    ])
    const shrunk = applyCommand(grown, { type: 'trimElement', elementId: 'e-a', durationMs: 500 })
    expect(order(shrunk, trackId)).toEqual([
      ['e-a', 0],
      ['e-b', 500],
    ])
  })

  test('removing a clip closes the gap', () => {
    const { project, trackId } = magneticProject()
    const next = applyCommand(project, { type: 'removeElement', elementId: 'e-a' })
    expect(order(next, trackId)).toEqual([['e-b', 0]])
  })

  test('dropping a new clip between others inserts at the slot', () => {
    const { project, trackId } = magneticProject()
    // Left edge at 800 ≥ A's midpoint (500), before B's midpoint (1200) → slot 1.
    const next = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-c', text: 'C', startMs: 800, durationMs: 200 },
    })
    expect(order(next, trackId)).toEqual([
      ['e-a', 0],
      ['e-c', 1000],
      ['e-b', 1200],
    ])
  })

  test('splitting keeps both halves adjacent', () => {
    const { project, trackId } = magneticProject()
    const next = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-a',
      atMs: 400,
      rightElementId: 'e-a2',
    })
    expect(order(next, trackId)).toEqual([
      ['e-a', 0],
      ['e-a2', 400],
      ['e-b', 1000],
    ])
  })
})

describe('tool definitions', () => {
  test('every command is exposed as an MCP-shaped tool with JSON Schema params', () => {
    const tools = listToolDefinitions()
    expect(tools.length).toBe(listCommands().length)
    const split = tools.find((t) => t.name === 'splitElement')!
    expect(split.description).toContain('Split')
    expect(split.inputSchema.type).toBe('object')
    const properties = split.inputSchema.properties as Record<string, unknown>
    expect(Object.keys(properties)).toContain('elementId')
    expect(Object.keys(properties)).toContain('atMs')
  })
})
