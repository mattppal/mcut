import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { resolveAnimatedElement } from './keyframes'
import { type MulticamElement } from './model'
import { getActiveLayout } from './multicam'
import { createMc, mc, projectWithRecordings } from './multicam-fixture'
import { getReframeCenter } from './reframe'
import { getElement } from './selectors'
import { getClipView, listZoomRegions } from './zoom-regions'

describe('split + flatten', () => {
  test('splitting a multicam moves the window and copies the switch list', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 10_000, layoutId: camLayout.id })
    next = applyCommand(next, { type: 'splitElement', elementId: 'e-mc', atMs: 6000, rightElementId: 'e-mc2' })

    const left = mc(next)
    const right = getElement(next, 'e-mc2' as `e-${string}`) as MulticamElement
    const schedule = [
      { atMs: 0, layoutId: next.layouts[0]!.id },
      { atMs: 10_000, layoutId: camLayout.id },
    ]
    expect(left.angles).toEqual(schedule)
    expect(right.angles).toEqual(schedule)
    expect(right.trimStartMs).toBe(6000)
    expect(right.sources.map((s) => s.offsetMs)).toEqual([0, 0])
    expect(getActiveLayout(next, right, 15_000)?.id).toBe(camLayout.id)
  })

  test('flatten explodes spans into plain clips + audio', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 12_000, layoutId: camLayout.id })
    next = applyCommand(next, { type: 'flattenMulticam', elementId: 'e-mc' })

    expect(getElement(next, 'e-mc' as `e-${string}`)).toBeUndefined()
    const all = next.tracks.flatMap((t) => t.elements)
    const videos = all.filter((e) => e.type === 'video')
    const audios = all.filter((e) => e.type === 'audio')
    expect(videos).toHaveLength(3)
    expect(audios).toHaveLength(1)
    expect(audios[0]).toMatchObject({ assetId: 'a-cam', startMs: 0, durationMs: 30_000 })
    expect(videos.every((v) => v.type === 'video' && v.muted)).toBe(true)
  })

  test('flatten carries the camera reframe track onto every camera clip', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const reframe = [
      { sourceMs: 0, x: 0.2, y: 0.4 },
      { sourceMs: 20_000, x: 0.8, y: 0.6 },
    ]
    next = applyCommand(next, {
      type: 'updateElement',
      elementId: 'e-mc',
      patch: { sources: mc(next).sources.map((s) => (s.key === 'camera' ? { ...s, reframe } : s)) },
    })
    const multicam = mc(next)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 12_000, layoutId: camLayout.id })
    next = applyCommand(next, { type: 'flattenMulticam', elementId: 'e-mc' })

    const cameraClips = next.tracks.flatMap((t) => t.elements).filter((e) => e.type === 'video' && e.assetId === 'a-cam')
    expect(cameraClips.length).toBeGreaterThan(0)
    for (const clip of cameraClips) {
      if (clip.type !== 'video') throw new Error('expected a video clip')
      expect(clip.reframe).toEqual(reframe)
      const t = clip.startMs + Math.floor(clip.durationMs / 2)
      expect(getReframeCenter(clip, undefined, t)).toEqual(getReframeCenter(multicam, 'camera', t))
    }
  })

  test('flatten carries each source zoom onto the clips cut from that source', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayoutId = next.layouts.find((l) => l.name === 'Camera')?.id
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 12_000, layoutId: camLayoutId })
    next = applyCommand(next, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-screen', source: 'screen', atMs: 1000 } })
    next = applyCommand(next, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { id: 'z-cam', source: 'camera', atMs: 10_000, holdMs: 4600 } })
    next = applyCommand(next, { type: 'flattenMulticam', elementId: 'e-mc' })

    expect(listZoomRegions(next).map(({ id, atMs, startMs, endMs }) => ({ id, atMs, startMs, endMs }))).toEqual([
      { id: 'z-screen', atMs: 1000, startMs: 1000, endMs: 4000 },
      { id: 'z-cam-r', atMs: -2000, startMs: 12_000, endMs: 16_000 },
      { id: 'z-cam', atMs: 10_000, startMs: 10_000, endMs: 12_000 },
    ])
    const camTail = next.tracks.flatMap((t) => t.elements).find((e) => e.type === 'video' && e.startMs === 12_000)
    expect(camTail?.type === 'video' && getClipView(camTail, 13_000).scale).toBe(1.15)
  })

  test('flatten bakes a whole-composite zoom into each clip box', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayoutId = next.layouts.find((l) => l.name === 'Camera')?.id
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 12_000, layoutId: camLayoutId })
    const zoom = { atMs: 2000, inMs: 600, holdMs: 1000, outMs: 600, scale: 1.5, focus: { x: 0.84, y: 0.83 } }
    next = applyCommand(next, { type: 'addZoomRegion', elementId: 'e-mc', zoom })
    const multicam = mc(next)
    const pip = { x: 0.7, y: 0.69, w: 0.275, h: 0.275 }
    const full = { x: 0, y: 0, w: 1, h: 1 }
    next = applyCommand(next, { type: 'flattenMulticam', elementId: 'e-mc' })

    const videos = next.tracks.flatMap((t) => t.elements).filter((e) => e.type === 'video')
    const clipAt = (assetId: string, startMs: number) => {
      const clip = videos.find((v) => v.assetId === assetId && v.startMs === startMs)
      if (clip?.type !== 'video') throw new Error(`no ${assetId} clip at ${startMs}`)
      return clip
    }
    const screen = clipAt('a-screen', 0)
    const camera = clipAt('a-cam', 0)
    const clipBox = (clip: typeof screen, ms: number) => {
      const { transform } = resolveAnimatedElement(clip, ms)
      const natural = clip.assetId === 'a-screen' ? { w: 2560, h: 1440 } : { w: 1920, h: 1080 }
      const w = natural.w * Math.abs(transform.scaleX)
      const h = natural.h * Math.abs(transform.scaleY)
      return { x: 960 + transform.x - w / 2, y: 540 + transform.y - h / 2, w, h }
    }
    const slotBox = (rect: typeof pip, ms: number) => {
      const view = getClipView(multicam, ms)
      const left = view.focus.x * (1 - 1 / view.scale) * 1920
      const top = view.focus.y * (1 - 1 / view.scale) * 1080
      return { x: (rect.x * 1920 - left) * view.scale, y: (rect.y * 1080 - top) * view.scale, w: rect.w * 1920 * view.scale, h: rect.h * 1080 * view.scale }
    }
    const expectBox = (actual: ReturnType<typeof clipBox>, expected: ReturnType<typeof clipBox>) => {
      for (const key of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThan(1)
    }

    expectBox(clipBox(camera, 1000), { x: 1344, y: 745.2, w: 528, h: 297 })
    expectBox(clipBox(camera, 2060), { x: 1320, y: 729, w: 660, h: 371.25 })
    expectBox(clipBox(screen, 2060), { x: -360, y: -202.5, w: 2400, h: 1350 })
    expectBox(clipBox(camera, 3000), { x: 1056, y: 577.8, w: 792, h: 445.5 })
    expectBox(clipBox(screen, 3000), { x: -960, y: -540, w: 2880, h: 1620 })
    expectBox(clipBox(camera, 3660), { x: 1320, y: 729, w: 660, h: 371.25 })
    expectBox(clipBox(camera, 5000), { x: 1344, y: 745.2, w: 528, h: 297 })
    for (let ms = 1990; ms <= 4210; ms += 1) {
      expectBox(clipBox(camera, ms), slotBox(pip, ms))
      expectBox(clipBox(screen, ms), slotBox(full, ms))
    }

    expect(camera.motionBlur).toEqual({ enabled: true, shutterAngle: 180 })
    const cameraTail = clipAt('a-cam', 12_000)
    expect(cameraTail.keyframes).toBeUndefined()
    expect(cameraTail.motionBlur).toBeUndefined()
    expect(cameraTail.transform).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  })
})
