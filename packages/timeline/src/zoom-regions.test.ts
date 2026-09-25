import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { EditorEngine } from './engine'
import { createProject, splitElementAt, type MulticamElement, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import { summarizeProject } from './summarize'
import { thrownBy } from './test-helpers'
import { getClipView, getSlotView, getZoomShutterMs, listZoomRegions, type ZoomRegion } from './zoom-regions'

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
    engine.dispatch({ type: 'updateZoomRegion', elementId: 'e-screen', zoomId: 'z-open', patch: { focus: { x: 0.75, y: 0.25 }, scale: 2 } })
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
      zoom: { preset: 'detailZoom', atMs: 1000, inMs: 1000, holdMs: 1000, outMs: 1000, focus: { x: 0.75, y: 0.75 }, scale: 2 },
    })
    const clip = video(project, 'e-screen')
    expect(getClipView(clip, 500)).toEqual({ scale: 1, focus: { x: 0.5, y: 0.5 } })
    expect(getClipView(clip, 1100).scale).toBeCloseTo(1.5, 1)
    expect(getClipView(clip, 2500)).toEqual({ scale: 2, focus: { x: 1, y: 1 } })
    expect(getClipView(clip, 4000)).toEqual({ scale: 1, focus: { x: 0.5, y: 0.5 } })
    expect(getZoomShutterMs(clip, 1100, 40)).toBe(20)
    expect(getZoomShutterMs(clip, 2500, 40)).toBe(0)
  })

  test('a rect aims the zoom at its center and fills it only up to the preset scale', () => {
    const add = (zoom: { preset?: 'subtlePunchIn' | 'detailZoom'; rect: { x: number; y: number; w: number; h: number } }) =>
      listZoomRegions(applyCommand(projectWithScreenAndCam(), { type: 'addZoomRegion', elementId: 'e-screen', zoom: { id: 'z', atMs: 0, ...zoom } }))[0]
    const detail = add({ preset: 'detailZoom', rect: { x: 0.2, y: 0.1, w: 0.5, h: 0.4 } })
    expect(detail?.scale).toBe(1.3)
    expect(detail?.focus.x).toBeCloseTo(0.45, 6)
    expect(detail?.focus.y).toBeCloseTo(0.3, 6)
    expect(add({ rect: { x: 0.2, y: 0.1, w: 0.5, h: 0.4 } })?.scale).toBe(1.15)
    expect(add({ preset: 'detailZoom', rect: { x: 0, y: 0, w: 0.9, h: 0.9 } })?.scale).toBeCloseTo(1.111, 3)
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

  test('a whole zooms array written by updateElement or addElement cannot overlap on one target', () => {
    const zoom = (id: string, atMs: number): ZoomRegion => ({
      id,
      atMs,
      inMs: 700,
      holdMs: 1600,
      outMs: 700,
      focus: { x: 0.5, y: 0.5 },
      scale: 1.15,
      easing: 'easeOutExpo',
      motionBlur: 0.5,
    })
    const project = applyCommand(projectWithScreenAndCam(), { type: 'addTrack' })
    const freeTrack = project.tracks[2]?.id ?? 't-default'
    const clashing = [zoom('z-late', 2000), zoom('z-open', 0)]
    expect(thrownBy(() => applyCommand(project, { type: 'updateElement', elementId: 'e-screen', patch: { zooms: clashing } }))).toMatchObject({
      message: expect.stringContaining('overlap'),
    })
    expect(
      thrownBy(() =>
        applyCommand(project, {
          type: 'addElement',
          trackId: freeTrack,
          element: { type: 'video', id: 'e-extra', assetId: 'a-screen', startMs: 0, durationMs: 10_000, zooms: clashing },
        }),
      ),
    ).toMatchObject({ message: expect.stringContaining('overlap') })
    const apart = applyCommand(project, { type: 'updateElement', elementId: 'e-screen', patch: { zooms: [zoom('z-open', 0), zoom('z-late', 3000)] } })
    expect(listZoomRegions(apart).map((z) => z.id)).toEqual(['z-open', 'z-late'])
  })

  test('a split through a zoom keeps the picture on both sides of the cut', () => {
    const project = applyCommand(projectWithScreenAndCam(), {
      type: 'addZoomRegion',
      elementId: 'e-screen',
      zoom: { id: 'z-mid', atMs: 9000, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 1.5, focus: { x: 0.3, y: 0.3 } },
    })
    const whole = video(project, 'e-screen')
    const split = applyCommand(project, { type: 'splitElement', elementId: 'e-screen', atMs: 10_500, rightElementId: 'e-right' })
    const left = video(split, 'e-screen')
    const right = video(split, 'e-right')
    for (const t of [10_000, 10_400]) expect(getClipView(left, t)).toEqual(getClipView(whole, t))
    for (const t of [10_500, 11_500]) expect(getClipView(right, t)).toEqual(getClipView(whole, t))
  })

  test.each([
    ['splitElement', () => ({ type: 'splitElement', elementId: 'e-screen', atMs: 10_500 })],
    [
      'an insert edit',
      (trackId: string) => ({
        type: 'addElement',
        trackId,
        editMode: 'insert',
        element: { type: 'video', assetId: 'a-cam', startMs: 10_500, durationMs: 1000 },
      }),
    ],
    [
      'an overwrite edit',
      (trackId: string) => ({
        type: 'addElement',
        trackId,
        editMode: 'overwrite',
        element: { type: 'video', assetId: 'a-cam', startMs: 10_500, durationMs: 100 },
      }),
    ],
  ])('the right piece of a cut through a zoom by %s gets its own zoom id', (_, cut) => {
    const project = applyCommand(projectWithScreenAndCam(), {
      type: 'addZoomRegion',
      elementId: 'e-screen',
      zoom: { id: 'z-mid', atMs: 9000, inMs: 1000, holdMs: 1000, outMs: 1000 },
    })
    const after = applyCommand(project, cut(project.tracks[0]?.id ?? 't-default'))
    expect(listZoomRegions(after).map((z) => z.id)).toEqual(['z-mid', 'z-mid-r'])
  })

  test('agent views clip a zoom that crosses a split to the piece that plays it', () => {
    const project = applyCommand(projectWithScreenAndCam(), {
      type: 'addZoomRegion',
      elementId: 'e-screen',
      zoom: { id: 'z-mid', atMs: 9000, inMs: 1000, holdMs: 1000, outMs: 1000 },
    })
    const split = applyCommand(project, { type: 'splitElement', elementId: 'e-screen', atMs: 10_500, rightElementId: 'e-right' })
    expect(listZoomRegions(split).map(({ id, elementId, atMs, startMs, endMs }) => ({ id, elementId, atMs, startMs, endMs }))).toEqual([
      { id: 'z-mid', elementId: 'e-screen', atMs: 9000, startMs: 9000, endMs: 10_500 },
      { id: 'z-mid-r', elementId: 'e-right', atMs: -1500, startMs: 10_500, endMs: 12_000 },
    ])
    expect(summarizeProject(split)).toContain('[zooms: z-mid-r 1.15x @ 10.50s]')
  })

  test('a zoom left past the clip end by a trim does not block edits to other zooms', () => {
    let project = applyCommand(projectWithScreenAndCam(), { type: 'addZoomRegion', elementId: 'e-screen', zoom: { id: 'z-end', atMs: 26_000 } })
    project = applyCommand(project, { type: 'trimEdge', elementId: 'e-screen', edge: 'end', deltaMs: -2000 })
    project = applyCommand(project, { type: 'addZoomRegion', elementId: 'e-screen', zoom: { id: 'z-open', atMs: 0 } })
    expect(listZoomRegions(project).map((z) => z.id)).toEqual(['z-open', 'z-end'])
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

  test('the target center lands in the middle of a slot narrower than the video', () => {
    let project = applyCommand(projectWithScreenAndCam(), { type: 'createMulticam', elementIds: ['e-screen', 'e-cam'], multicamId: 'e-mc' })
    project = applyCommand(project, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { source: 'screen', atMs: 0, scale: 1.5, focus: { x: 0.43, y: 0.5 } } })
    const slot = project.layouts.find((l) => l.name === 'Screen + Cam 3:4')?.slots.find((s) => s.source === 'screen')
    if (!slot) throw new Error('3:4 layout lost its screen slot')
    const visibleX = (slot.rect.w * 1280) / (slot.rect.h * 720 * (1280 / 720))
    const view = getSlotView(multicam(project), slot, 1000, { x: visibleX, y: 1 })
    const windowX = visibleX / view.scale
    expect((1 - windowX) * view.focus.x + windowX / 2).toBeCloseTo(0.43, 5)
  })

  test('renaming a source key carries its zooms along', () => {
    let project = applyCommand(projectWithScreenAndCam(), { type: 'createMulticam', elementIds: ['e-screen', 'e-cam'], multicamId: 'e-mc' })
    project = applyCommand(project, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { source: 'screen', atMs: 0 } })
    project = applyCommand(project, { type: 'setMulticamSourceKey', elementId: 'e-mc', sourceKey: 'screen', newKey: 'display' })
    expect(listZoomRegions(project).map((z) => z.source)).toEqual(['display'])
  })
})
