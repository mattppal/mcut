import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, getElement, type MulticamElement, type Project } from '@mcut/timeline'
import {
  fromCanvasPoint,
  getElementDisplaySize,
  getElementNaturalSize,
  getElementOBB,
  getFitScale,
  getHandles,
  getTransformForDisplaySize,
  hitTestHandles,
  hitTestOBB,
  toCanvasPoint,
  type SizeHelpers,
} from './geometry'
import { getSlotBoxes, type SlotBox } from './multicam'

describe('coordinate conversion', () => {
  test('round-trips center-origin coordinates', () => {
    const project = createProject()
    expect(toCanvasPoint(project, 0, 0)).toEqual({ x: 960, y: 540 })
    expect(toCanvasPoint(project, -100, 50)).toEqual({ x: 860, y: 590 })
    expect(fromCanvasPoint(project, 860, 590)).toEqual({ x: -100, y: 50 })
  })
})

describe('getElementOBB', () => {
  const project = createProject()

  test('media element uses asset size times scale', () => {
    const obb = getElementOBB(
      project,
      {
        id: 'e-1',
        type: 'image',
        startMs: 0,
        durationMs: 1000,
        assetId: 'a-1',
        transform: { x: 10, y: -20, scaleX: 2, scaleY: 0.5, rotation: 45 },
        opacity: 1,
      },
      { getAssetSize: () => ({ width: 400, height: 300 }) },
    )
    expect(obb).toEqual({ cx: 970, cy: 520, width: 800, height: 150, rotation: 45 })
  })

  test('returns null for unknown sizes, audio, and captions', () => {
    expect(
      getElementOBB(project, {
        id: 'e-2',
        type: 'audio',
        startMs: 0,
        durationMs: 1000,
        assetId: 'a-1',
        trimStartMs: 0,
        volume: 1,
        muted: false,
      }),
    ).toBeNull()
    expect(
      getElementOBB(project, {
        id: 'e-3',
        type: 'image',
        startMs: 0,
        durationMs: 1000,
        assetId: 'a-1',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        opacity: 1,
      }),
    ).toBeNull()
  })

  test('text element uses measured box size times scale', () => {
    const element = {
      id: 'e-text',
      type: 'text',
      startMs: 0,
      durationMs: 1000,
      text: 'hello world',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 64,
        fontWeight: 600,
        fontStyle: 'normal',
        color: '#fff',
        align: 'center',
        letterSpacing: 0,
        lineHeight: 1.25,
        textTransform: 'none',
      },
      box: { width: 300, height: 120, overflow: 'clip' },
      transform: { x: 0, y: 0, scaleX: 2, scaleY: 0.5, rotation: 0 },
      opacity: 1,
    } as const
    const helpers: SizeHelpers = {
      measureText: (_text, _style, box) => ({
        width: box?.width ?? 90,
        height: box?.height ?? 40,
      }),
    }

    expect(getElementNaturalSize(project, element, helpers)).toEqual({ width: 300, height: 120 })
    expect(getElementDisplaySize(project, element, helpers)).toEqual({ width: 600, height: 60 })
    expect(getElementOBB(project, element, helpers)).toMatchObject({ width: 600, height: 60 })
  })
})

function screenAndCamera(frame: Partial<Pick<MulticamElement, 'transform' | 'crop'>> = {}, camera = { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }): Project {
  let project = createProject({ width: 1920, height: 1080 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
  const slots = [
    { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { source: 'camera', rect: camera },
  ]
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-pip', name: 'Screen + Cam', slots } })
  const sources = [
    { key: 'screen', assetId: 'a-screen' },
    { key: 'camera', assetId: 'a-cam' },
  ]
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-mc', type: 'multicam', startMs: 0, durationMs: 5000, sources, angles: [{ atMs: 0, layoutId: 'l-pip' }], ...frame },
  })
}

function multicamIn(project: Project): MulticamElement {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('no multicam e-mc')
  return element
}

const rounded = (boxes: SlotBox[]) =>
  boxes.map(({ sourceKey, obb }) => ({ sourceKey, obb: Object.fromEntries(Object.entries(obb).map(([key, value]) => [key, Math.round(value * 1000) / 1000])) }))

describe('multicam geometry', () => {
  test('a multicam is the project frame, cut by its crop, under its transform', () => {
    const project = screenAndCamera({ transform: { x: 100, y: -50, scaleX: 0.5, scaleY: -0.5, rotation: 30 }, crop: { x: 0, y: 0, w: 0.5, h: 1 } })
    const element = multicamIn(project)
    expect(getElementNaturalSize(project, element)).toEqual({ width: 960, height: 1080 })
    expect(getElementDisplaySize(project, element)).toEqual({ width: 480, height: 540 })
    expect(getElementOBB(project, element)).toEqual({ cx: 1060, cy: 490, width: 480, height: 540, rotation: 30 })
  })

  test('slot boxes place the screen over the frame and the camera in its corner', () => {
    const project = screenAndCamera()
    expect(getSlotBoxes(project, multicamIn(project), 1000)).toEqual([
      { sourceKey: 'screen', obb: { cx: 960, cy: 540, width: 1920, height: 1080, rotation: 0 } },
      { sourceKey: 'camera', obb: { cx: 1680, cy: 945, width: 480, height: 270, rotation: 0 } },
    ])
  })

  test('slot boxes follow the scale, rotation, and position of the multicam, cut by its crop', () => {
    const project = screenAndCamera({ transform: { x: 100, y: -50, scaleX: 0.5, scaleY: 0.5, rotation: 90 }, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    expect(rounded(getSlotBoxes(project, multicamIn(project), 1000))).toEqual([
      { sourceKey: 'screen', obb: { cx: 1060, cy: 490, width: 480, height: 270, rotation: 90 } },
      { sourceKey: 'camera', obb: { cx: 992.5, cy: 610, width: 240, height: 135, rotation: 90 } },
    ])
  })

  test('slot boxes follow a held zoom without source, cut at the frame, and leave out a slot the zoom moves off it', () => {
    const zoom = { inMs: 100, holdMs: 2000, outMs: 100, scale: 2, motionBlur: 0 }
    const pip = screenAndCamera({}, { x: 0.65, y: 0.6, w: 0.25, h: 0.3 })
    const right = applyCommand(pip, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { ...zoom, atMs: 0, focus: { x: 0.75, y: 0.5 } } })
    const project = applyCommand(right, { type: 'addZoomRegion', elementId: 'e-mc', zoom: { ...zoom, atMs: 2500, focus: { x: 0.25, y: 0.25 } } })
    const screen = { sourceKey: 'screen', obb: { cx: 960, cy: 540, width: 1920, height: 1080, rotation: 0 } }
    expect(rounded(getSlotBoxes(project, multicamIn(project), 1000))).toEqual([
      screen,
      { sourceKey: 'camera', obb: { cx: 1056, cy: 918, width: 960, height: 324, rotation: 0 } },
    ])
    expect(rounded(getSlotBoxes(project, multicamIn(project), 3000))).toEqual([screen])
  })
})

describe('flipped elements (negative scale)', () => {
  const natural = { width: 400, height: 300 }
  const helpers: SizeHelpers = { getAssetSize: () => natural }
  const flipped = {
    id: 'e-flip',
    type: 'image',
    startMs: 0,
    durationMs: 1000,
    assetId: 'a-1',
    transform: { x: 0, y: 0, scaleX: -2, scaleY: -0.5, rotation: 0 },
    opacity: 1,
  } as const

  test('display size stays unsigned', () => {
    expect(getElementDisplaySize(createProject(), flipped, helpers)).toEqual({ width: 800, height: 150 })
  })

  test('resizing by display size keeps each axis flip', () => {
    const resized = getTransformForDisplaySize(flipped.transform, natural, {
      width: 400,
      height: 600,
    })
    expect(resized).toMatchObject({ scaleX: -1, scaleY: -2 })
    const aspect = getTransformForDisplaySize(flipped.transform, natural, {
      width: 1200,
      preserveAspect: true,
    })
    expect(aspect).toMatchObject({ scaleX: -3, scaleY: -3 })
  })
})

describe('hit testing', () => {
  test('axis-aligned box', () => {
    const obb = { cx: 100, cy: 100, width: 80, height: 40, rotation: 0 }
    expect(hitTestOBB(obb, 100, 100)).toBe(true)
    expect(hitTestOBB(obb, 139, 119)).toBe(true)
    expect(hitTestOBB(obb, 141, 100)).toBe(false)
  })

  test('rotated box', () => {
    const obb = { cx: 0, cy: 0, width: 100, height: 20, rotation: 90 }
    expect(hitTestOBB(obb, 0, 45)).toBe(true)
    expect(hitTestOBB(obb, 45, 0)).toBe(false)
  })

  test('handles are positioned and hit-testable', () => {
    const obb = { cx: 0, cy: 0, width: 100, height: 60, rotation: 0 }
    const handles = getHandles(obb)
    const se = handles.find((h) => h.id === 'se')!
    expect(se).toMatchObject({ x: 50, y: 30 })
    const rotate = handles.find((h) => h.id === 'rotate')!
    expect(rotate.y).toBeLessThan(-30)
    expect(hitTestHandles(obb, 51, 29)).toBe('se')
    expect(hitTestHandles(obb, 0, 0)).toBeNull()
  })
})

describe('getFitScale', () => {
  test('contains media within the project frame', () => {
    const project = createProject()
    expect(getFitScale(project, 3840, 2160)).toBe(0.5)
    expect(getFitScale(project, 960, 1080)).toBe(1)
    expect(getFitScale(project, 100, 1080)).toBe(1)
  })
})
