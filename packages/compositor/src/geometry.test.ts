import { describe, expect, test } from 'bun:test'
import { createProject } from '@mcut/timeline'
import {
  fromCanvasPoint,
  getElementDisplaySize,
  getElementNaturalSize,
  getElementOBB,
  getFitScale,
  getHandles,
  hitTestHandles,
  hitTestOBB,
  toCanvasPoint,
  type SizeHelpers,
} from './geometry'

describe('coordinate conversion', () => {
  test('round-trips center-origin coordinates', () => {
    const project = createProject() // 1920x1080
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

    expect(getElementNaturalSize(element, helpers)).toEqual({ width: 300, height: 120 })
    expect(getElementDisplaySize(element, helpers)).toEqual({ width: 600, height: 60 })
    expect(getElementOBB(project, element, helpers)).toMatchObject({ width: 600, height: 60 })
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
    // Rotated 90°: now tall and narrow.
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
    const project = createProject() // 1920x1080
    expect(getFitScale(project, 3840, 2160)).toBe(0.5)
    expect(getFitScale(project, 960, 1080)).toBe(1)
    expect(getFitScale(project, 100, 1080)).toBe(1)
  })
})
