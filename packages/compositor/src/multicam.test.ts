import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import type { RenderBackend } from './backend'
import { renderFrame, renderFrameWith } from './render-frame'
import { deviceRect, FakeContext2D, onCanvas } from './test-utils'
import type { Canvas2D, RenderFrameOptions } from './types'

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

type Camera = { rect: LayoutSlot['rect']; fit?: LayoutSlot['fit'] }

const FULL = { x: 0, y: 0, w: 1, h: 1 }

function multicam(element: object, cameras: readonly Camera[] = [{ rect: FULL }]): Project {
  let project = createProject({ width: 1920, height: 1080 })
  for (const index of cameras.keys()) {
    project = applyCommand(project, { type: 'addAsset', asset: { id: `a-${index}`, kind: 'video', src: `blob:${index}`, durationMs: 60_000 } })
  }
  const slots = cameras.map(({ rect, fit }, index) => ({ source: `cam-${index}`, rect, ...(fit ? { fit } : {}) }))
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

const placed = (x: number, y: number, scaleX: number, scaleY = scaleX) => ({ transform: { x, y, scaleX, scaleY, rotation: 0 } })
const scaled = (scaleX: number, scaleY = scaleX) => placed(0, 0, scaleX, scaleY)

const zoomed = (element: object, source?: string) =>
  applyCommand(multicam(element), {
    type: 'addZoomRegion',
    elementId: 'e-mc',
    zoom: { atMs: 0, inMs: 500, holdMs: 1000, outMs: 500, scale: 2, motionBlur: 0, ...(source ? { source } : {}) },
  })

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

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

const frame: ImageBitmap = { width: 640, height: 360, close: () => {} }

function renderComposed(
  project: Project,
  timeMs = 1000,
  renderScale = 1,
  options: RenderFrameOptions = {},
): { main: FakeContext2D; scratches: FakeContext2D[] } {
  const main = new FakeContext2D(1920 * renderScale, 1080 * renderScale)
  main.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  const scratches: FakeContext2D[] = []
  renderFrame(asCtx(main), project, timeMs, {
    ...options,
    source: { getFrame: () => frame },
    createScratchContext: (width, height) => {
      const scratch = new FakeContext2D(width, height)
      scratches.push(scratch)
      return asCtx(scratch)
    },
  })
  return { main, scratches }
}

describe('multicam compose density', () => {
  test('a multicam composes at the density its transform lands on the canvas', () => {
    expect(composeSizes(multicam(scaled(0.5)))).toEqual([[960, 540]])
    expect(composeSizes(multicam(scaled(0.5, 0.25)))).toEqual([[960, 270]])
    expect(composeSizes(multicam(scaled(0.5)), { renderScale: 0.5 })).toEqual([[480, 270]])
    expect(composeSizes(multicam(scaled(-0.5, 0.5)))).toEqual([[960, 540]])
  })

  test('keyframed scale sets the density of each frame', () => {
    let project = multicam({})
    for (const property of ['scale.x', 'scale.y'] as const) {
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 0, value: 0.25, easing: 'linear' })
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 2000, value: 0.75 })
    }
    expect(composeSizes(project, { timeMs: 0 })).toEqual([[480, 270]])
    expect(composeSizes(project, { timeMs: 1000 })).toEqual([[960, 540]])
  })

  test('the density rounds up to quarter octaves, so nearby scales share one scratch size', () => {
    expect([0.6, 0.65, 0.7, 0.8].flatMap((scale) => composeSizes(multicam(scaled(scale))))).toEqual([
      [1358, 764],
      [1358, 764],
      [1358, 764],
      [1615, 909],
    ])
  })

  test('sizing tolerates float error, so a scratch matches the canvas pixels it lands on', () => {
    expect(composeSizes(multicam({}), { renderScale: 248 / 1920 })).toEqual([[248, 140]])
    expect(composeSizes(multicam({ ...scaled(1 / 0.6), crop: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }), { renderScale: 0.1 })).toEqual([[192, 108]])
  })

  test('a zoom region leaves the compose size to the transform and the render scale', () => {
    expect(composeSizes(zoomed(scaled(0.5)))).toEqual([[960, 540]])
    expect(composeSizes(zoomed({}), { renderScale: 0.5 })).toEqual([[960, 540]])
    expect(composeSizes(zoomed({}, 'cam-0'))).toEqual([[1920, 1080]])
  })

  test('crop composes only the kept part of the frame, at the density of the transform', () => {
    expect(composeSizes(multicam({ ...scaled(2), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }))).toEqual([[1920, 1080]])
    expect(composeSizes(multicam({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }))).toEqual([[960, 540]])
  })

  test('each compose clears the whole scratch before it draws, because the pool hands the same canvas to the next frame', () => {
    const { scratches } = renderComposed(multicam({ ...scaled(2), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }))
    const painted = scratches.flatMap(({ calls }) => calls.filter(({ method }) => method === 'clearRect' || method === 'drawImage'))
    expect(painted.map((call) => [call.method, ...deviceRect(call)])).toEqual([
      ['clearRect', 0, 0, 1920, 1080],
      ['drawImage', -960, -540, 3840, 2160],
    ])
  })

  test('a side stops at 8192 pixels and the frame squeezes into it', () => {
    const { scratches } = renderComposed(multicam({}), 1000, 8)
    expect(scratches.map(({ canvas }) => [canvas.width, canvas.height])).toEqual([[8192, 8192]])
    expect(scratches.flatMap((scratch) => scratch.callsTo('drawImage').map(deviceRect))).toEqual([[0, 0, 8192, 8192]])
  })
})

describe('multicam compose window', () => {
  const sizesOf = (scratches: readonly FakeContext2D[]) => scratches.map(({ canvas }) => [canvas.width, canvas.height])

  test('a held 2x zoom composes only the window it draws, one scratch pixel per canvas pixel', () => {
    const { main, scratches } = renderComposed(zoomed({}))
    expect(sizesOf(scratches)).toEqual([[1920, 1080]])
    expect(scratches.flatMap((scratch) => scratch.callsTo('drawImage').map(deviceRect))).toEqual([[-960, -540, 3840, 2160]])
    expect(scratches.flatMap((scratch) => onCanvas(main, scratch, 'drawImage'))).toEqual([[-960, -540, 3840, 2160]])
  })

  test('a multicam magnified past the canvas composes only the part the canvas shows, one scratch pixel per canvas pixel', () => {
    const { main, scratches } = renderComposed(multicam(scaled(2)))
    expect(sizesOf(scratches)).toEqual([[1920, 1080]])
    expect(scratches.flatMap((scratch) => scratch.callsTo('drawImage').map(deviceRect))).toEqual([[-960, -540, 3840, 2160]])
    expect(scratches.flatMap((scratch) => onCanvas(main, scratch, 'drawImage'))).toEqual([[-960, -540, 3840, 2160]])
    expect(composeSizes(multicam(scaled(2)), { renderScale: 0.5 })).toEqual([[960, 540]])
    expect(composeSizes(multicam(scaled(-2, 1)))).toEqual([[1920, 1080]])
    expect(composeSizes(multicam(placed(960, 0, 1)))).toEqual([[960, 1080]])
    expect(composeSizes(multicam({ transform: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 90 } }))).toEqual([[1142, 2160]])
  })

  test('each motion blur sample composes only the part the canvas shows', () => {
    let project = multicam({ motionBlur: { enabled: true, shutterAngle: 180 } })
    for (const property of ['scale.x', 'scale.y'] as const) {
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 0, value: 2, easing: 'linear' })
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 2000, value: 3 })
    }
    expect(sizesOf(renderComposed(project, 1000, 1, { motionBlurSamples: 2 }).scratches)).toEqual([
      [1920, 1080],
      [1920, 1080],
      [1920, 1080],
      [1920, 1080],
    ])
  })

  test('a multicam in a track transition composes its whole crop, because the transition moves it on the canvas', () => {
    let project = applyCommand(multicam(scaled(2)), {
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-next', type: 'text', text: 'NEXT', startMs: 5000, durationMs: 2000 },
    })
    project = applyCommand(project, { type: 'setTransition', elementId: 'e-mc', transition: { type: 'slide-left', durationMs: 1000 } })
    expect(sizesOf(renderComposed(project, 4000).scratches)).toEqual([[1920, 1080]])
    expect(sizesOf(renderComposed(project, 4750).scratches)).toEqual([[3840, 2160]])
  })

  test('an effect that reads neighboring pixels, or a shadow, composes the whole crop so nothing near the canvas edge goes missing', () => {
    const blur = { type: 'blur', enabled: true, radius: 4 }
    const dropShadow = { type: 'drop-shadow', enabled: true, offsetX: 0, offsetY: 8, blur: 12, color: '#000000' }
    const brightness = { type: 'brightness', enabled: true, amount: 1.2 }
    expect(composeSizes(multicam({ ...scaled(2), effects: [blur] }))).toEqual([[3840, 2160]])
    expect(composeSizes(multicam({ ...scaled(2), effects: [brightness, dropShadow] }))).toEqual([[3840, 2160]])
    expect(composeSizes(multicam({ ...scaled(2), effects: [{ type: 'css', enabled: true, filter: 'blur(2px)' }] }))).toEqual([[3840, 2160]])
    expect(composeSizes(multicam({ ...scaled(2), shadow: { color: 'rgba(0,0,0,0.5)', blur: 20, offsetX: 0, offsetY: 8 } }))).toEqual([[3840, 2160]])
    expect(composeSizes(multicam({ ...scaled(2), effects: [brightness, { ...blur, enabled: false }] }))).toEqual([[1920, 1080]])
  })

  test('a multicam wholly off the canvas composes its whole crop', () => {
    expect(composeSizes(multicam(placed(3000, 0, 1)))).toEqual([[1920, 1080]])
  })
})

describe('multicam zoom and crop', () => {
  test('a crop cuts the composite after a zoom without source scales it, where main draws them', () => {
    const drawn = (element: object) => {
      const project = applyCommand(multicam({ crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, ...element }), {
        type: 'addZoomRegion',
        elementId: 'e-mc',
        zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, focus: { x: 0, y: 0 } },
      })
      const { main, scratches } = renderComposed(project, 1500)
      return {
        crop: main.callsTo('drawImage').map(deviceRect),
        zoomClip: scratches.flatMap((scratch) => onCanvas(main, scratch, 'rect')),
        slots: scratches.flatMap((scratch) => onCanvas(main, scratch, 'drawImage')),
      }
    }
    expect(drawn({})).toEqual({ crop: [[480, 270, 960, 540]], zoomClip: [[-480, -270, 1920, 1080]], slots: [[-480, -270, 3840, 2160]] })
    expect(drawn(placed(200, -100, 1.5))).toEqual({
      crop: [[440, 35, 1440, 810]],
      zoomClip: [[-1000, -775, 2880, 1620]],
      slots: [[-1000, -775, 5760, 3240]],
    })
    expect(drawn(placed(600, 0, 1.5))).toEqual({
      crop: [[840, 135, 1440, 810]],
      zoomClip: [[-600, -675, 2880, 1620]],
      slots: [[-600, -675, 5760, 3240]],
    })
  })
})

describe('multicam slot framing', () => {
  test('a contain slot keeps its letterboxed side whole and centered while a slot zoom pans the other side', () => {
    const project = applyCommand(multicam({}, [{ rect: { x: 0, y: 0, w: 0.25, h: 1 }, fit: 'contain' }]), {
      type: 'addZoomRegion',
      elementId: 'e-mc',
      zoom: { source: 'cam-0', atMs: 0, inMs: 500, holdMs: 1000, outMs: 500, scale: 2, focus: { x: 1, y: 1 } },
    })
    const { scratches } = renderComposed(project)
    expect(scratches.flatMap((scratch) => scratch.callsTo('drawImage').map((c) => c.args.slice(1)))).toEqual([[320, 0, 320, 360, -960, -270, 480, 540]])
  })
})
