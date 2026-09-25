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

function screenAndCamera(): Project {
  let project = applyCommand(createProject({ width: 1920, height: 1080 }), { type: 'addTrack', id: 't-cam' })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 2560, height: 1440 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, width: 1920, height: 1080 } })
  const screen = { type: 'video', id: 'e-s', assetId: 'a-screen', startMs: 0, durationMs: 10_000 }
  project = applyCommand(project, { type: 'addElement', trackId: 't-default', element: screen })
  project = applyCommand(project, { type: 'addElement', trackId: 't-cam', element: { ...screen, id: 'e-c', assetId: 'a-cam' } })
  return applyCommand(project, { type: 'createMulticam', sources: [{ elementId: 'e-s' }, { elementId: 'e-c' }], multicamId: 'e-mc' })
}

function multicamIn(project: Project): MulticamElement {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('no multicam e-mc')
  return element
}

describe('multicam geometry', () => {
  test('a multicam is the project frame, cut by its crop, under its transform', () => {
    const project = applyCommand(screenAndCamera(), {
      type: 'updateElement',
      elementId: 'e-mc',
      patch: { transform: { x: 100, y: -50, scaleX: 0.5, scaleY: -0.5, rotation: 30 }, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
    })
    const element = multicamIn(project)
    expect(getElementNaturalSize(project, element)).toEqual({ width: 960, height: 1080 })
    expect(getElementDisplaySize(project, element)).toEqual({ width: 480, height: 540 })
    expect(getElementOBB(project, element)).toEqual({ cx: 1060, cy: 490, width: 480, height: 540, rotation: 30 })
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
