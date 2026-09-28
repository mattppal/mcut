import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { CommandError } from './errors'
import type { ElementId } from './id'
import { createProject, type MulticamElement, type Project } from './model'
import { getActiveLayout } from './multicam'
import { summarizeProject } from './summarize'
import { thrownBy } from './test-helpers'
import { getSlotView, listZoomRegions } from './zoom-regions'

const SCREEN_SLOT = { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' as const }

function withMulticam(angles: MulticamElement['angles'] = [{ atMs: 0, layoutId: 'l-screen' }]): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-screen', name: 'Screen', slots: [SCREEN_SLOT] } })
  project = applyCommand(project, {
    type: 'saveLayout',
    layout: { id: 'l-cam', name: 'Camera', slots: [{ source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 } }] },
  })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 30_000,
      trimStartMs: 0,
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-cam', offsetMs: 0 },
      ],
      angles,
      audioSource: 'camera',
    },
  })
}

const cutRetake = (project: Project) => applyCommand(project, { type: 'removeRanges', ranges: [{ startMs: 5000, endMs: 12_000 }] })

function pieces(project: Project): [MulticamElement, MulticamElement] {
  const [first, second] = project.tracks[0]?.elements.filter((e): e is MulticamElement => e.type === 'multicam') ?? []
  if (!first || !second) throw new Error('expected two multicam pieces')
  return [first, second]
}

const layoutAt = (project: Project, element: MulticamElement, timelineMs: number) => getActiveLayout(project, element, timelineMs)?.id

describe('angle cuts in timeline time on a multicam cut into pieces', () => {
  test('addAngleCut lands on the timeline time asked for, stored on the source clock', () => {
    const cut = cutRetake(withMulticam())
    const [, second] = pieces(cut)
    const next = applyCommand(cut, { type: 'addAngleCut', elementId: second.id, atMs: 8000, layoutId: 'l-cam', time: 'timeline' })
    const [, after] = pieces(next)
    expect(after.angles).toEqual([
      { atMs: 0, layoutId: 'l-screen' },
      { atMs: 15_000, layoutId: 'l-cam' },
    ])
    expect(layoutAt(next, after, 7999)).toBe('l-screen')
    expect(layoutAt(next, after, 8000)).toBe('l-cam')
    expect(summarizeProject(next)).toContain('cuts at timeline: 5.00s→Screen, 8.00s→Camera')
  })

  test('a timeline time outside the piece is rejected and names the piece that plays it', () => {
    const cut = cutRetake(withMulticam())
    const [first, second] = pieces(cut)
    const error = thrownBy(() => applyCommand(cut, { type: 'addAngleCut', elementId: second.id, atMs: 3000, layoutId: 'l-cam', time: 'timeline' }))
    expect(error).toBeInstanceOf(CommandError)
    expect(String(error)).toContain(`That time is on "${first.id}"`)
  })

  test('a source time outside the piece is rejected', () => {
    const cut = cutRetake(withMulticam())
    const [, second] = pieces(cut)
    const error = thrownBy(() => applyCommand(cut, { type: 'addAngleCut', elementId: second.id, atMs: 8000, layoutId: 'l-cam' }))
    expect(error).toBeInstanceOf(CommandError)
    expect(String(error)).toContain('plays source 12000 to 30000ms')
  })

  test('moveAngleCut, setAngleLayout, and removeAngleCut find cuts by the timeline times get_summary lists', () => {
    const cut = cutRetake(withMulticam())
    const id = pieces(cut)[1].id
    let next = applyCommand(cut, { type: 'addAngleCut', elementId: id, atMs: 8000, layoutId: 'l-cam', time: 'timeline' })
    next = applyCommand(next, { type: 'moveAngleCut', elementId: id, fromMs: 8010, toMs: 9000, time: 'timeline' })
    expect(layoutAt(next, pieces(next)[1], 8500)).toBe('l-screen')
    expect(layoutAt(next, pieces(next)[1], 9000)).toBe('l-cam')
    next = applyCommand(next, { type: 'setAngleLayout', elementId: id, atMs: 5000, layoutId: 'l-cam', time: 'timeline' })
    expect(layoutAt(next, pieces(next)[1], 5000)).toBe('l-cam')
    next = applyCommand(next, { type: 'removeAngleCut', elementId: id, atMs: 9000, time: 'timeline' })
    expect(pieces(next)[1].angles).toEqual([{ atMs: 0, layoutId: 'l-cam' }])
    expect(thrownBy(() => applyCommand(next, { type: 'removeAngleCut', elementId: id, atMs: 9000, time: 'timeline' }))).toBeInstanceOf(CommandError)
  })

  test('cutting a range keeps only the cuts each piece plays', () => {
    const cut = cutRetake(
      withMulticam([
        { atMs: 0, layoutId: 'l-screen' },
        { atMs: 3000, layoutId: 'l-cam' },
        { atMs: 8000, layoutId: 'l-screen' },
        { atMs: 20_000, layoutId: 'l-screen' },
      ]),
    )
    const [first, second] = pieces(cut)
    expect(first.angles.map((a) => a.atMs)).toEqual([0, 3000])
    expect(second.angles.map((a) => a.atMs)).toEqual([8000, 20_000])
    expect(layoutAt(cut, second, 5000)).toBe('l-screen')
  })

  test('splitting a piece drops the cuts outside each half', () => {
    let project = withMulticam([
      { atMs: 0, layoutId: 'l-screen' },
      { atMs: 4000, layoutId: 'l-cam' },
      { atMs: 20_000, layoutId: 'l-screen' },
    ])
    project = applyCommand(project, { type: 'splitElement', elementId: 'e-mc', atMs: 10_000, rightElementId: 'e-right' })
    const [left, right] = pieces(project)
    expect(left.angles.map((a) => a.atMs)).toEqual([0, 4000])
    expect(right.angles.map((a) => a.atMs)).toEqual([4000, 20_000])
  })
})

describe('zooms in timeline time on a multicam cut into pieces', () => {
  const zoom = { id: 'z-punch', source: 'screen', atMs: 10_000, inMs: 700, holdMs: 1600, outMs: 700 }

  test('addZoomRegion places the zoom at the timeline time asked for', () => {
    const cut = cutRetake(withMulticam())
    const second = pieces(cut)[1]
    const next = applyCommand(cut, { type: 'addZoomRegion', elementId: second.id, zoom, time: 'timeline' })
    expect(pieces(next)[1].zooms?.[0]?.atMs).toBe(5000)
    expect(listZoomRegions(next).map(({ id, startMs, endMs }) => ({ id, startMs, endMs }))).toEqual([{ id: 'z-punch', startMs: 10_000, endMs: 13_000 }])
    expect(getSlotView(pieces(next)[1], SCREEN_SLOT, 11_000).scale).toBe(1.15)
    expect(summarizeProject(next)).toContain('[zooms at timeline: z-punch screen 1.15x 10.00s to 13.00s]')
  })

  test('a timeline zoom across a cut is copied onto each piece and plays as one zoom', () => {
    const cut = cutRetake(withMulticam())
    const [first] = pieces(cut)
    const next = applyCommand(cut, { type: 'addZoomRegion', elementId: first.id, zoom: { ...zoom, atMs: 4000 }, time: 'timeline' })
    expect(listZoomRegions(next).map(({ id, elementId, atMs, startMs, endMs }) => ({ id, elementId, atMs, startMs, endMs }))).toEqual([
      { id: 'z-punch', elementId: first.id, atMs: 4000, startMs: 4000, endMs: 5000 },
      { id: 'z-punch-r', elementId: pieces(next)[1].id, atMs: -1000, startMs: 5000, endMs: 7000 },
    ])
    const [left, right] = pieces(next)
    expect(getSlotView(left, SCREEN_SLOT, 4999).scale).toBe(1.15)
    expect(getSlotView(right, SCREEN_SLOT, 5000).scale).toBe(1.15)
    expect(getSlotView(right, SCREEN_SLOT, 7000).scale).toBe(1)
  })

  test('a timeline zoom running past the last piece is rejected', () => {
    const cut = cutRetake(withMulticam())
    const error = thrownBy(() => applyCommand(cut, { type: 'addZoomRegion', elementId: pieces(cut)[1].id, zoom: { ...zoom, atMs: 22_000 }, time: 'timeline' }))
    expect(error).toBeInstanceOf(CommandError)
    expect(String(error)).toContain('past the last multicam piece, which ends at 23000ms')
  })

  test('updateZoomRegion retimes a zoom by timeline time', () => {
    const cut = cutRetake(withMulticam())
    const id: ElementId = pieces(cut)[1].id
    let next = applyCommand(cut, { type: 'addZoomRegion', elementId: id, zoom, time: 'timeline' })
    next = applyCommand(next, { type: 'updateZoomRegion', elementId: id, zoomId: 'z-punch', patch: { atMs: 15_000 }, time: 'timeline' })
    expect(listZoomRegions(next)[0]?.startMs).toBe(15_000)
    const outside = thrownBy(() => applyCommand(next, { type: 'updateZoomRegion', elementId: id, zoomId: 'z-punch', patch: { atMs: 3000 }, time: 'timeline' }))
    expect(String(outside)).toContain('which plays timeline 5000 to 23000ms')
  })
})
