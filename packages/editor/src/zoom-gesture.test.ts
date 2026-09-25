import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, getElement, isZoomable, type ElementId, type ZoomableElement, type ZoomRegion } from '@mcut/timeline'
import { planZoomAtPlayhead, planZoomRegionDrag, type ZoomRegionDragMode } from './zoom-gesture'

type Timing = { atMs: number; inMs: number; holdMs: number; outMs: number }

function engineWithVideo(): EditorEngine {
  const engine = new EditorEngine({ project: createProject() })
  const trackId = engine.project.tracks[0]?.id ?? 't-default'
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, width: 1280, height: 720 } })
  engine.dispatch({ type: 'addElement', trackId, element: { type: 'video', id: 'e-clip', assetId: 'a-screen', startMs: 1000, durationMs: 10_000 } })
  return engine
}

function engineWithTwoZooms(): EditorEngine {
  const engine = engineWithVideo()
  engine.dispatch({ type: 'addZoomRegion', elementId: 'e-clip', zoom: { id: 'z-a', atMs: 2000 } })
  engine.dispatch({ type: 'addZoomRegion', elementId: 'e-clip', zoom: { id: 'z-b', atMs: 7000 } })
  return engine
}

function engineWithMulticam(): EditorEngine {
  const engine = engineWithVideo()
  engine.dispatch({ type: 'addTrack', id: 't-cam' })
  engine.dispatch({ type: 'addElement', trackId: 't-cam', element: { type: 'video', id: 'e-cam', assetId: 'a-cam', startMs: 1000, durationMs: 10_000 } })
  engine.dispatch({ type: 'createMulticam', elementIds: ['e-clip', 'e-cam'], multicamId: 'e-mc' })
  return engine
}

function zoomable(engine: EditorEngine, id: ElementId): ZoomableElement {
  const element = getElement(engine.project, id)
  if (!element || !isZoomable(element)) throw new Error(`${id} cannot zoom`)
  return element
}

function zoomOf(engine: EditorEngine, elementId: ElementId, zoomId: string): ZoomRegion {
  const zoom = zoomable(engine, elementId).zooms?.find((z) => z.id === zoomId)
  if (!zoom) throw new Error(`${elementId} has no zoom ${zoomId}`)
  return zoom
}

function dragAndCommit(engine: EditorEngine, elementId: ElementId, zoomId: string, mode: ZoomRegionDragMode, deltaMs: number): Timing {
  const { atMs, inMs, holdMs, outMs } = planZoomRegionDrag(zoomable(engine, elementId), zoomOf(engine, elementId, zoomId), mode, deltaMs)
  engine.dispatch({ type: 'updateZoomRegion', elementId, zoomId, patch: { atMs, inMs, holdMs, outMs } })
  const committed = zoomOf(engine, elementId, zoomId)
  return { atMs: committed.atMs, inMs: committed.inMs, holdMs: committed.holdMs, outMs: committed.outMs }
}

function engineSplitThroughZoom(splitAtMs: number): EditorEngine {
  const engine = engineWithVideo()
  engine.dispatch({ type: 'addZoomRegion', elementId: 'e-clip', zoom: { id: 'z-cut', atMs: 1500 } })
  engine.dispatch({ type: 'splitElement', elementId: 'e-clip', atMs: splitAtMs, rightElementId: 'e-right' })
  return engine
}

describe('planZoomRegionDrag', () => {
  test.each<[ZoomRegionDragMode, number, Timing]>([
    ['move', 500, { atMs: 2500, inMs: 700, holdMs: 1600, outMs: 700 }],
    ['start', -400, { atMs: 1600, inMs: 700, holdMs: 2000, outMs: 700 }],
    ['in', 300, { atMs: 2000, inMs: 1000, holdMs: 1300, outMs: 700 }],
    ['out', -200, { atMs: 2000, inMs: 700, holdMs: 1400, outMs: 900 }],
    ['end', 800, { atMs: 2000, inMs: 700, holdMs: 2400, outMs: 700 }],
  ])('%s by %dms moves only its own boundaries', (mode, deltaMs, expected) => {
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-a', mode, deltaMs)).toEqual(expected)
  })

  test.each<[ZoomRegionDragMode, number, Timing]>([
    ['move', 9000, { atMs: 4000, inMs: 700, holdMs: 1600, outMs: 700 }],
    ['move', -9000, { atMs: 0, inMs: 700, holdMs: 1600, outMs: 700 }],
    ['start', 9000, { atMs: 3600, inMs: 700, holdMs: 0, outMs: 700 }],
    ['start', -9000, { atMs: 0, inMs: 700, holdMs: 3600, outMs: 700 }],
    ['in', 9000, { atMs: 2000, inMs: 2300, holdMs: 0, outMs: 700 }],
    ['in', -9000, { atMs: 2000, inMs: 1, holdMs: 2299, outMs: 700 }],
    ['out', 9000, { atMs: 2000, inMs: 700, holdMs: 2299, outMs: 1 }],
    ['out', -9000, { atMs: 2000, inMs: 700, holdMs: 0, outMs: 2300 }],
    ['end', 9000, { atMs: 2000, inMs: 700, holdMs: 3600, outMs: 700 }],
    ['end', -9000, { atMs: 2000, inMs: 700, holdMs: 0, outMs: 700 }],
  ])('%s by %dms clamps to a timing updateZoomRegion accepts', (mode, deltaMs, expected) => {
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-a', mode, deltaMs)).toEqual(expected)
  })

  test('the last zoom stops at the clip end', () => {
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-b', 'move', 2000)).toEqual({ atMs: 7000, inMs: 700, holdMs: 1600, outMs: 700 })
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-b', 'end', 2000)).toEqual({ atMs: 7000, inMs: 700, holdMs: 1600, outMs: 700 })
  })

  test('a left drag stops at the end of the zoom before it', () => {
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-b', 'move', -9000)).toEqual({ atMs: 5000, inMs: 700, holdMs: 1600, outMs: 700 })
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-b', 'start', -9000)).toEqual({ atMs: 5000, inMs: 700, holdMs: 3600, outMs: 700 })
  })

  test('a fractional delta rounds to a whole millisecond', () => {
    expect(dragAndCommit(engineWithTwoZooms(), 'e-clip', 'z-a', 'move', 250.6)).toEqual({ atMs: 2251, inMs: 700, holdMs: 1600, outMs: 700 })
  })

  test('only zooms on the same multicam source block the drag', () => {
    const engine = engineWithMulticam()
    engine.dispatch({ type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-screen', source: 'screen', atMs: 0 } })
    engine.dispatch({ type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-cam', source: 'camera', atMs: 4000 } })
    engine.dispatch({ type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-late', source: 'screen', atMs: 8000, holdMs: 0, inMs: 1000, outMs: 1000 } })
    expect(dragAndCommit(engine, 'e-mc', 'z-screen', 'move', 9000)).toEqual({ atMs: 5000, inMs: 700, holdMs: 1600, outMs: 700 })
  })

  test('a drag pulls a zoom cut off by a split back inside its half', () => {
    expect(dragAndCommit(engineSplitThroughZoom(4000), 'e-clip', 'z-cut', 'end', 300)).toEqual({ atMs: 1500, inMs: 700, holdMs: 100, outMs: 700 })
    expect(dragAndCommit(engineSplitThroughZoom(4000), 'e-right', 'z-cut-r', 'move', 200)).toEqual({ atMs: 0, inMs: 700, holdMs: 1600, outMs: 700 })
    expect(dragAndCommit(engineSplitThroughZoom(4000), 'e-right', 'z-cut-r', 'start', 200)).toEqual({ atMs: 0, inMs: 700, holdMs: 100, outMs: 700 })
  })

  test.each<[ZoomRegionDragMode, number, ElementId, string, Timing]>([
    ['move', 3500, 'e-clip', 'z-cut', { atMs: 1500, inMs: 700, holdMs: 1600, outMs: 700 }],
    ['start', 4900, 'e-right', 'z-cut-r', { atMs: -2400, inMs: 700, holdMs: 1600, outMs: 700 }],
    ['end', 3700, 'e-clip', 'z-cut', { atMs: 1500, inMs: 700, holdMs: 1600, outMs: 700 }],
  ])('the %s drag leaves a zoom it cannot fit in its piece unchanged', (mode, splitAtMs, elementId, zoomId, expected) => {
    const engine = engineSplitThroughZoom(splitAtMs)
    const { atMs, inMs, holdMs, outMs } = planZoomRegionDrag(zoomable(engine, elementId), zoomOf(engine, elementId, zoomId), mode, 100)
    expect({ atMs, inMs, holdMs, outMs }).toEqual(expected)
  })
})

describe('planZoomAtPlayhead', () => {
  test('starts the zoom at the playhead in element-local time', () => {
    const engine = engineWithVideo()
    const clip = zoomable(engine, 'e-clip')
    expect(planZoomAtPlayhead(clip, 'subtlePunchIn', 4000)).toEqual({
      type: 'addZoomRegion',
      elementId: 'e-clip',
      zoom: { preset: 'subtlePunchIn', atMs: 3000 },
    })
    expect(planZoomAtPlayhead(clip, 'detailZoom', 10_500).zoom.atMs).toBe(5800)
    expect(planZoomAtPlayhead(clip, 'subtlePunchIn', 500).zoom.atMs).toBe(0)
    expect(planZoomAtPlayhead(clip, 'subtlePunchIn', 4000.6).zoom.atMs).toBe(3001)
    expect(planZoomAtPlayhead(clip, { scale: 1.35, inMs: 400, holdMs: 1000, outMs: 600, easing: 'easeInOut' }, 11_000).zoom).toEqual({
      scale: 1.35,
      inMs: 400,
      holdMs: 1000,
      outMs: 600,
      easing: 'easeInOut',
      atMs: 8000,
    })
  })

  test('targets the screen source of a multicam, or its first source without one', () => {
    const engine = engineWithMulticam()
    engine.dispatch({ type: 'setMulticamSourceKey', elementId: 'e-mc', sourceKey: 'camera', newKey: 'screen' })
    const swapped = zoomable(engine, 'e-mc')
    expect(swapped.type === 'multicam' && swapped.sources.map((s) => s.key)).toEqual(['camera', 'screen'])
    expect(planZoomAtPlayhead(zoomable(engine, 'e-mc'), 'subtlePunchIn', 1000).zoom.source).toBe('screen')
    engine.dispatch({ type: 'setMulticamSourceKey', elementId: 'e-mc', sourceKey: 'screen', newKey: 'slides' })
    expect(planZoomAtPlayhead(zoomable(engine, 'e-mc'), 'subtlePunchIn', 1000).zoom.source).toBe('camera')
  })
})
