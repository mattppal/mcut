import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { EditorEngine } from './engine'
import { createProject, splitElementAt, type MulticamElement, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import { thrownBy } from './test-helpers'
import { getClipView, getSlotView, getZoomShutterMs, listZoomRegions } from './zoom-regions'

function projectWithScreenAndCam(): Project {
  let project = createProject({ width: 1280, height: 720 })
  const trackId = project.tracks[0]?.id ?? 't-default'
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 30_000 },
  })
  project = applyCommand(project, { type: 'addTrack' })
  const camTrack = project.tracks[1]?.id ?? 't-default'
  return applyCommand(project, {
    type: 'addElement',
    trackId: camTrack,
    element: { type: 'video', id: 'e-cam', assetId: 'a-cam', startMs: 0, durationMs: 30_000 },
  })
}

function video(project: Project, id: `e-${string}`): VideoElement {
  const element = getElement(project, id)
  if (element?.type !== 'video') throw new Error(`${id} is not a video`)
  return element
}

function multicam(project: Project): MulticamElement {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('e-mc is not a multicam')
  return element
}

describe('zoom regions on a clip', () => {
  test('add, update, and remove are one undo step each and list in timeline time', () => {
    const engine = new EditorEngine({ project: projectWithScreenAndCam() })
    engine.dispatch({ type: 'addZoomRegion', elementId: 'e-screen', zoom: { id: 'z-open', atMs: 0 } })
    engine.dispatch({ type: 'updateZoomRegion', elementId: 'e-screen', zoomId: 'z-open', patch: { rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } } })
    expect(listZoomRegions(engine.project)).toEqual([
      {
        id: 'z-open',
        elementId: 'e-screen',
        atMs: 0,
        inMs: 700,
        holdMs: 1600,
        outMs: 700,
        focus: { x: 0.75, y: 0.25 },
        scale: 2,
        easing: 'easeOutExpo',
        motionBlur: 0.5,
        startMs: 0,
        endMs: 3000,
      },
    ])
    engine.dispatch({ type: 'removeZoomRegion', elementId: 'e-screen', zoomId: 'z-open' })
    expect(listZoomRegions(engine.project)).toEqual([])
    engine.undo()
    expect(listZoomRegions(engine.project)[0]?.scale).toBe(2)
    engine.undo()
    expect(listZoomRegions(engine.project)[0]?.scale).toBe(1.15)
  })

  test('the view eases in with expo, holds on the target corner, and returns to full frame', () => {
    const project = applyCommand(projectWithScreenAndCam(), {
      type: 'addZoomRegion',
      elementId: 'e-screen',
      zoom: { preset: 'detailZoom', atMs: 1000, inMs: 1000, holdMs: 1000, outMs: 1000, rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
    })
    const clip = video(project, 'e-screen')
    expect(getClipView(clip, 500)).toEqual({ scale: 1, focus: { x: 0.5, y: 0.5 } })
    expect(getClipView(clip, 1100).scale).toBeCloseTo(1.5, 1)
    expect(getClipView(clip, 2500)).toEqual({ scale: 2, focus: { x: 1, y: 1 } })
    expect(getClipView(clip, 4000)).toEqual({ scale: 1, focus: { x: 0.5, y: 0.5 } })
    expect(getZoomShutterMs(clip, undefined, 1100, 40)).toBe(20)
    expect(getZoomShutterMs(clip, undefined, 2500, 40)).toBe(0)
  })

  test('overlapping zooms, zooms past the clip end, and multicam-only sources are rejected', () => {
    const project = applyCommand(projectWithScreenAndCam(), { type: 'addZoomRegion', elementId: 'e-screen', zoom: { atMs: 0 } })
    expect(thrownBy(() => applyCommand(project, { type: 'addZoomRegion', elementId: 'e-screen', zoom: { atMs: 2000 } }))).toMatchObject({
      message: expect.stringContaining('overlap'),
    })
    expect(thrownBy(() => applyCommand(project, { type: 'addZoomRegion', elementId: 'e-screen', zoom: { atMs: 29_000 } }))).toMatchObject({
      code: 'out-of-bounds',
    })
    expect(thrownBy(() => applyCommand(project, { type: 'addZoomRegion', elementId: 'e-screen', zoom: { atMs: 5000, source: 'screen' } }))).toMatchObject({
      code: 'invalid-payload',
    })
  })

  test('a split hands each zoom to the half it starts in', () => {
    const project = applyCommand(projectWithScreenAndCam(), { type: 'addZoomRegion', elementId: 'e-screen', zoom: { id: 'z-late', atMs: 20_000 } })
    const { left, right } = splitElementAt(video(project, 'e-screen'), 10_000)
    expect(left.type === 'video' && left.zooms).toEqual([])
    expect(right.type === 'video' && right.zooms?.map((z) => [z.id, z.atMs])).toEqual([['z-late', 10_000]])
  })
})

describe('zoom regions on a multicam slot', () => {
  test('the screen slot zooms while the camera slot keeps its framing', () => {
    let project = applyCommand(projectWithScreenAndCam(), { type: 'createMulticam', elementIds: ['e-screen', 'e-cam'], multicamId: 'e-mc' })
    project = applyCommand(project, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { source: 'screen', atMs: 0, holdMs: 1000, focus: { x: 0.2, y: 0.3 } } })
    const layout = project.layouts.find((l) => l.name === 'Screen + Cam')
    const screenSlot = layout?.slots.find((s) => s.source === 'screen')
    const camSlot = layout?.slots.find((s) => s.source === 'camera')
    if (!screenSlot || !camSlot) throw new Error('default layout lost its slots')
    expect(getSlotView(multicam(project), screenSlot, 1000).scale).toBe(1.15)
    expect(getSlotView(multicam(project), camSlot, 1000)).toEqual({ scale: 1, focus: camSlot.focus })
    expect(thrownBy(() => applyCommand(project, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { atMs: 5000 } }))).toMatchObject({
      message: expect.stringContaining('screen'),
    })
  })
})
