import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, type Project } from './model'
import { getElement, getTrack } from './selectors'

const TRACK = 't-default'

function projectWithClips(): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-src', kind: 'video', src: 'blob:src', durationMs: 20_000 },
  })
  for (const [id, startMs] of [
    ['e-1', 0],
    ['e-2', 2000],
    ['e-3', 4000],
  ] as const) {
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: {
        id,
        type: 'video',
        assetId: 'a-src',
        startMs,
        durationMs: 2000,
        trimStartMs: 5000,
      },
    })
  }
  return project
}

const text = (id: string, startMs: number, durationMs: number) =>
  ({ id, type: 'text', text: id, startMs, durationMs }) as const

describe('editMode: normal (default)', () => {
  test('rejects collisions, as before', () => {
    expect(() =>
      applyCommand(projectWithClips(), {
        type: 'addElement',
        trackId: TRACK,
        element: text('e-new', 1000, 1000),
      }),
    ).toThrow(CommandError)
  })
})

describe('editMode: overwrite', () => {
  test('trims the head and tail neighbors around the landing range', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 1000, 2500),
      editMode: 'overwrite',
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 1000 })
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 1000, durationMs: 2500 })
    // e-2 lost its head: starts at 3500, source advanced by 1500.
    expect(getElement(project, 'e-2')).toMatchObject({
      startMs: 3500,
      durationMs: 500,
      trimStartMs: 6500,
    })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 4000, durationMs: 2000 })
  })

  test('removes fully covered clips', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 1500, 3000),
      editMode: 'overwrite',
    })
    expect(getElement(project, 'e-2')).toBeUndefined()
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 1500 })
  })

  test('splits a clip that fully contains the landing range', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 500, 1000),
      editMode: 'overwrite',
    })
    const track = getTrack(project, TRACK)!
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 500 })
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 500, durationMs: 1000 })
    const tail = track.elements.find(
      (e) => e.startMs === 1500 && e.id !== 'e-new' && e.id !== 'e-1',
    )
    expect(tail).toMatchObject({ durationMs: 500, trimStartMs: 6500 })
  })

  test('drops sub-minimum slivers', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 5, 1995),
      editMode: 'overwrite',
    })
    // e-1's 5ms head sliver is gone entirely.
    expect(getElement(project, 'e-1')).toBeUndefined()
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 5 })
  })

  test('moveElement supports overwrite', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'moveElement',
      elementId: 'e-3',
      startMs: 1000,
      editMode: 'overwrite',
    })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 1000, durationMs: 2000 })
    expect(getElement(project, 'e-1')).toMatchObject({ durationMs: 1000 })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 3000, durationMs: 1000 })
  })
})

describe('editMode: insert', () => {
  test('splits the straddling clip and ripples everything right', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 1000, 500),
      editMode: 'insert',
    })
    const track = getTrack(project, TRACK)!
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 1000 })
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 1000, durationMs: 500 })
    const tail = track.elements.find((e) => e.startMs === 1500 && e.id !== 'e-new')
    expect(tail).toMatchObject({ durationMs: 1000, trimStartMs: 6000 })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 2500 })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 4500 })
  })

  test('shifts other unlocked tracks but not locked ones', () => {
    let project = projectWithClips()
    project = applyCommand(project, { type: 'addTrack', id: 't-b' })
    project = applyCommand(project, { type: 'addTrack', id: 't-locked' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-b',
      element: text('e-b', 3000, 500),
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-locked',
      element: text('e-l', 3000, 500),
    })
    project = applyCommand(project, { type: 'setTrackFlags', trackId: 't-locked', locked: true })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 2000, 1000),
      editMode: 'insert',
    })
    expect(getElement(project, 'e-b')).toMatchObject({ startMs: 4000 })
    expect(getElement(project, 'e-l')).toMatchObject({ startMs: 3000 })
  })

  test('at a butt cut, nothing splits and downstream shifts', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 2000, 1000),
      editMode: 'insert',
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 2000 })
    expect(getElement(project, 'e-new')).toMatchObject({ startMs: 2000 })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 3000 })
  })

  test('moveElement with insert ripples at the landing point', () => {
    const project = applyCommand(projectWithClips(), {
      type: 'moveElement',
      elementId: 'e-3',
      startMs: 0,
      editMode: 'insert',
    })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 0 })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 2000 })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 4000 })
  })
})

describe('magnetic tracks ignore edit modes', () => {
  test('slot placement still applies', () => {
    let project = projectWithClips()
    project = applyCommand(project, { type: 'setTrackFlags', trackId: TRACK, magnetic: true })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: text('e-new', 100, 500),
      editMode: 'overwrite',
    })
    const track = getTrack(project, TRACK)!
    // Nothing was carved; the new clip took a slot and the track re-packed.
    expect(track.elements).toHaveLength(4)
    expect(track.elements.reduce((sum, e) => sum + e.durationMs, 0)).toBe(6500)
  })
})
