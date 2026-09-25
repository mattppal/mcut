import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { getFrameRequests } from './frame-requests'
import type { ElementId } from './id'
import { createProject, type MulticamElement, type Project } from './model'
import { getActiveLayout, getMulticamGroupTimeMs, getVisibleAngleCuts } from './multicam'
import { getElement } from './selectors'
import { mustFind, thrownBy } from './test-helpers'

const TRACK = 't-default'

function withMulticam(overrides: Partial<MulticamElement> = {}): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:m', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-still', kind: 'image', src: 'blob:i' } })
  const full = { x: 0, y: 0, w: 1, h: 1 }
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-screen', name: 'Screen', slots: [{ source: 'screen', rect: full }] } })
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-cam', name: 'Camera', slots: [{ source: 'camera', rect: full }] } })
  return applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 10_000,
      trimStartMs: 1000,
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-cam', offsetMs: 300 },
      ],
      angles: [
        { atMs: 1000, layoutId: 'l-screen' },
        { atMs: 6000, layoutId: 'l-cam' },
      ],
      audioSource: 'camera',
      ...overrides,
    },
  })
}

function multicam(project: Project, id: ElementId = 'e-mc'): MulticamElement {
  const element = mustFind(getElement(project, id), id)
  if (element.type !== 'multicam') throw new Error(`${id} is ${element.type}`)
  return element
}

const layoutAt = (project: Project, element: MulticamElement, timelineMs: number) => getActiveLayout(project, element, timelineMs)?.id

const ANGLES = [
  { atMs: 1000, layoutId: 'l-screen' },
  { atMs: 6000, layoutId: 'l-cam' },
]

describe('multicam window edits', () => {
  test('setElementSpeed keeps each angle cut on the same content', () => {
    const project = applyCommand(withMulticam(), { type: 'setElementSpeed', elementId: 'e-mc', speed: 2 })
    const element = multicam(project)
    expect(element.durationMs).toBe(5000)
    expect(element.angles).toEqual(ANGLES)
    const [opening, cut] = getVisibleAngleCuts(element)
    expect(opening).toEqual({ atMs: 1000, localMs: 0, layoutId: 'l-screen' })
    expect(cut?.layoutId).toBe('l-cam')
    expect(cut?.localMs).toBeCloseTo(2500, 2)
    expect(layoutAt(project, element, 2400)).toBe('l-screen')
    expect(layoutAt(project, element, 2600)).toBe('l-cam')
  })

  test('splitting a sped-up multicam copies the angles and keeps content in place', () => {
    let project = applyCommand(withMulticam(), { type: 'setElementSpeed', elementId: 'e-mc', speed: 2 })
    project = applyCommand(project, { type: 'splitElement', elementId: 'e-mc', atMs: 2000, rightElementId: 'e-mc-right' })
    const left = multicam(project)
    const right = multicam(project, 'e-mc-right')
    expect(left.angles).toEqual(ANGLES)
    expect(right.angles).toEqual(ANGLES)
    expect(getMulticamGroupTimeMs(right, 2000)).toBe(5000)
    expect(layoutAt(project, right, 2400)).toBe('l-screen')
    expect(layoutAt(project, right, 2600)).toBe('l-cam')
  })

  test('splitting a reversed multicam copies the angles and keeps content in place', () => {
    let project = applyCommand(withMulticam(), { type: 'updateElement', elementId: 'e-mc', patch: { reversed: true } })
    project = applyCommand(project, { type: 'splitElement', elementId: 'e-mc', atMs: 4000, rightElementId: 'e-mc-right' })
    const left = multicam(project)
    const right = multicam(project, 'e-mc-right')
    expect(left.angles).toEqual(ANGLES)
    expect(right.angles).toEqual(ANGLES)
    expect(getMulticamGroupTimeMs(left, 0)).toBe(11_000)
    expect(getMulticamGroupTimeMs(right, 4000)).toBe(7000)
    expect(layoutAt(project, right, 4500)).toBe('l-cam')
    expect(layoutAt(project, right, 5500)).toBe('l-screen')
    expect(getVisibleAngleCuts(right)).toEqual([
      { atMs: 6000, localMs: 0, layoutId: 'l-cam' },
      { atMs: 6000, localMs: 1000, layoutId: 'l-screen' },
    ])
  })

  test('trimEdge extends the start of a speed-ramped multicam over earlier source', () => {
    const ramp = [
      { timeMs: 0, value: 0 },
      { timeMs: 2000, value: 2000 },
      { timeMs: 4000, value: 6000 },
    ]
    let project = withMulticam({ startMs: 3000, durationMs: 4000, trimStartMs: 2000, timeMap: ramp })
    const before = multicam(project)
    project = applyCommand(project, { type: 'trimEdge', elementId: 'e-mc', edge: 'start', deltaMs: -1000 })
    const after = multicam(project)
    expect(after).toMatchObject({
      startMs: 2000,
      durationMs: 5000,
      trimStartMs: 1000,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 1000, value: 1000 },
        { timeMs: 3000, value: 3000 },
        { timeMs: 5000, value: 7000 },
      ],
      angles: ANGLES,
    })
    for (const timelineMs of [3000, 4500, 6000]) {
      expect(getMulticamGroupTimeMs(after, timelineMs)).toBe(getMulticamGroupTimeMs(before, timelineMs))
    }
  })
})

describe('getVisibleAngleCuts', () => {
  test('lists the cuts inside the window at element-local positions', () => {
    const project = withMulticam({ angles: [...ANGLES, { atMs: 20_000, layoutId: 'l-screen' }] })
    expect(getVisibleAngleCuts(multicam(project))).toEqual([
      { atMs: 1000, localMs: 0, layoutId: 'l-screen' },
      { atMs: 6000, localMs: 5000, layoutId: 'l-cam' },
    ])
  })

  test('opens on the cut active at the in-point after a start trim', () => {
    const project = applyCommand(withMulticam(), { type: 'trimEdge', elementId: 'e-mc', edge: 'start', deltaMs: 2000 })
    expect(getVisibleAngleCuts(multicam(project))).toEqual([
      { atMs: 1000, localMs: 0, layoutId: 'l-screen' },
      { atMs: 6000, localMs: 3000, layoutId: 'l-cam' },
    ])
  })
})

describe('multicam sources', () => {
  test('an audio-only source in a layout slot is never drawn', () => {
    let project = withMulticam({
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'mic', assetId: 'a-mic', offsetMs: 0 },
      ],
      angles: [{ atMs: 0, layoutId: 'l-screen' }],
      audioSource: 'mic',
    })
    const slots = [
      { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
      { source: 'mic', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    ]
    project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-both', name: 'Both', slots } })
    project = applyCommand(project, { type: 'setAngleLayout', elementId: 'e-mc', atMs: 0, layoutId: 'l-both' })
    expect(getFrameRequests(project, multicam(project), 500)).toEqual([{ assetId: 'a-screen', sourceTimeMs: 1500 }])
  })

  test('rejects an image source and a window past the end of a source', () => {
    const image = thrownBy(() => withMulticam({ sources: [{ key: 'screen', assetId: 'a-still', offsetMs: 0 }] }))
    expect(image).toMatchObject({ code: 'invalid-payload' })
    const late = thrownBy(() => applyCommand(withMulticam(), { type: 'trimElement', elementId: 'e-mc', trimStartMs: 50_000 }))
    expect(late).toMatchObject({ code: 'out-of-bounds' })
  })

  test('removeAsset removes a multicam that reads the asset through a source', () => {
    const project = applyCommand(withMulticam(), { type: 'removeAsset', assetId: 'a-cam' })
    expect(getElement(project, 'e-mc')).toBeUndefined()
    expect(Object.keys(project.assets).sort()).toEqual(['a-mic', 'a-screen', 'a-still'])
  })

  test('a fast animation preset enables motion blur on a multicam', () => {
    const project = applyCommand(withMulticam(), { type: 'applyAnimationPreset', elementId: 'e-mc', preset: 'punch-zoom' })
    expect(multicam(project).motionBlur).toEqual({ enabled: true, shutterAngle: 180 })
  })
})

describe('angle cuts on the source clock', () => {
  test('moveAngleCut is bounded by its neighbors, not by the window', () => {
    const project = withMulticam()
    expect(multicam(applyCommand(project, { type: 'moveAngleCut', elementId: 'e-mc', fromMs: 6000, toMs: 50_000 })).angles[1]).toEqual({
      atMs: 50_000,
      layoutId: 'l-cam',
    })
    const crowded = applyCommand(project, { type: 'addAngleCut', elementId: 'e-mc', atMs: 8000, layoutId: 'l-screen' })
    expect(multicam(applyCommand(crowded, { type: 'moveAngleCut', elementId: 'e-mc', fromMs: 6000, toMs: 9000 })).angles[1]?.atMs).toBe(7999)
  })

  test('the first cut opens the schedule and cannot be removed', () => {
    const removed = thrownBy(() => applyCommand(withMulticam(), { type: 'removeAngleCut', elementId: 'e-mc', atMs: 1000 }))
    expect(removed).toMatchObject({ code: 'invalid-payload' })
  })
})
