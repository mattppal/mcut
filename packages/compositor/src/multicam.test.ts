import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import type { RenderBackend } from './backend'
import { renderFrameWith } from './render-frame'
import type { Canvas2D } from './types'

class SizingBackend implements RenderBackend {
  readonly kind = 'sizing'
  readonly width = 1920
  readonly height = 1080
  constructor(readonly renderScale: number) {}
  beginFrame(): void {}
  endFrame(): void {}
  acquireRaster(): Canvas2D {
    throw new Error('a multicam composes off the raster')
  }
  drawImageQuad(): void {}
  pushRasterScope(): void {}
  popRasterScope(): void {}
}

type Camera = { rect: LayoutSlot['rect']; size?: { width: number; height: number } }

const FULL = { x: 0, y: 0, w: 1, h: 1 }
const HD = { width: 1920, height: 1080 }

function multicam(element: object, cameras: readonly Camera[] = [{ rect: FULL }]): Project {
  let project = createProject({ width: 1920, height: 1080 })
  for (const [index, { size }] of cameras.entries()) {
    project = applyCommand(project, { type: 'addAsset', asset: { id: `a-${index}`, kind: 'video', src: `blob:${index}`, durationMs: 60_000, ...size } })
  }
  const slots = cameras.map(({ rect }, index) => ({ source: `cam-${index}`, rect }))
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-cams', name: 'Cameras', slots } })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: cameras.map((_, index) => ({ key: `cam-${index}`, assetId: `a-${index}` })),
      angles: [{ atMs: 0, layoutId: 'l-cams' }],
      ...element,
    },
  })
}

const scaled = (scaleX: number, scaleY = scaleX) => ({ transform: { x: 0, y: 0, scaleX, scaleY, rotation: 0 } })

function composeSizes(project: Project, { renderScale = 1, timeMs = 1000 } = {}): number[][] {
  const sizes: number[][] = []
  renderFrameWith(new SizingBackend(renderScale), project, timeMs, {
    source: { getFrame: () => null },
    createScratchContext: (width, height) => {
      sizes.push([width, height])
      return null
    },
  })
  return sizes
}

describe('multicam compose density', () => {
  test('a multicam composes at the density its transform lands on the canvas', () => {
    expect(composeSizes(multicam(scaled(2)))).toEqual([[3840, 2160]])
    expect(composeSizes(multicam(scaled(2)), { renderScale: 0.5 })).toEqual([[1920, 1080]])
    expect(composeSizes(multicam(scaled(0.5)))).toEqual([[960, 540]])
    expect(composeSizes(multicam(scaled(-2, 1)))).toEqual([[3840, 1080]])
  })

  test('keyframed scale sets the density of each frame', () => {
    let project = multicam({})
    for (const property of ['scale.x', 'scale.y'] as const) {
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 0, value: 1, easing: 'linear' })
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 2000, value: 3 })
    }
    expect(composeSizes(project, { timeMs: 0 })).toEqual([[1920, 1080]])
    expect(composeSizes(project, { timeMs: 1000 })).toEqual([[3840, 2160]])
  })

  test('magnification rounds up to quarter octaves, so nearby scales share one scratch size', () => {
    expect([1.2, 1.4, 1.5].flatMap((scale) => composeSizes(multicam(scaled(scale))))).toEqual([
      [2716, 1528],
      [2716, 1528],
      [3230, 1817],
    ])
  })

  test('crop narrows the composed frame without adding density', () => {
    expect(composeSizes(multicam({ ...scaled(2), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }))).toEqual([[3840, 2160]])
  })

  test('the densest source caps the density, never below the pass', () => {
    const screenWithPip = [
      { rect: FULL, size: HD },
      { rect: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }, size: HD },
    ]
    expect(composeSizes(multicam(scaled(2), [{ rect: FULL, size: HD }]))).toEqual([[1920, 1080]])
    expect(composeSizes(multicam(scaled(2), [{ rect: FULL, size: { width: 960, height: 540 } }]))).toEqual([[1920, 1080]])
    expect(composeSizes(multicam(scaled(2), screenWithPip))).toEqual([[3840, 2160]])
  })

  test('a side stops at 8192 pixels', () => {
    expect(composeSizes(multicam(scaled(2)), { renderScale: 4 })).toEqual([[8192, 8192]])
  })
})
