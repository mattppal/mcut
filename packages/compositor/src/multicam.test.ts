import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { deviceRect, FakeContext2D, onCanvas } from './test-utils'
import type { Canvas2D } from './types'

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

const zoomed = (element: object) =>
  applyCommand(multicam(element), {
    type: 'addZoomRegion',
    elementId: 'e-mc',
    zoom: { atMs: 0, inMs: 500, holdMs: 1000, outMs: 500, scale: 2, motionBlur: 0 },
  })

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

const frame: ImageBitmap = { width: 640, height: 360, close: () => {} }

function renderComposed(project: Project, timeMs = 1000, renderScale = 1): { main: FakeContext2D; scratches: FakeContext2D[] } {
  const main = new FakeContext2D(1920 * renderScale, 1080 * renderScale)
  main.setTransform(renderScale, 0, 0, renderScale, 0, 0)
  const scratches: FakeContext2D[] = []
  renderFrame(asCtx(main), project, timeMs, {
    source: { getFrame: () => frame },
    createScratchContext: (width, height) => {
      const scratch = new FakeContext2D(width, height)
      scratches.push(scratch)
      return asCtx(scratch)
    },
  })
  return { main, scratches }
}

function composed(project: Project, timeMs = 1000, renderScale = 1) {
  const { main, scratches } = renderComposed(project, timeMs, renderScale)
  return {
    scratch: scratches.map(({ canvas }) => [canvas.width, canvas.height]),
    cleared: scratches.flatMap((scratch) => scratch.callsTo('clearRect').map(deviceRect)),
    slots: scratches.flatMap((scratch) => onCanvas(main, scratch, 'drawImage')),
    copied: main.callsTo('drawImage').map(({ args }) => args.slice(1, 5)),
    landed: main.callsTo('drawImage').map(deviceRect),
  }
}

describe('multicam compose grid', () => {
  test('a multicam composes on a scratch the size of the canvas, at the canvas pixels it covers, and copies those pixels one to one', () => {
    expect(composed(multicam(scaled(0.5)))).toEqual({
      scratch: [[1920, 1080]],
      cleared: [[480, 270, 960, 540]],
      slots: [[480, 270, 960, 540]],
      copied: [[480, 270, 960, 540]],
      landed: [[480, 270, 960, 540]],
    })
    expect(composed(multicam(scaled(0.5)), 1000, 0.5)).toEqual({
      scratch: [[960, 540]],
      cleared: [[240, 135, 480, 270]],
      slots: [[240, 135, 480, 270]],
      copied: [[240, 135, 480, 270]],
      landed: [[240, 135, 480, 270]],
    })
  })

  test('a scale animation keeps one scratch size, so the pool hands back the same canvas every frame', () => {
    let project = multicam({})
    for (const property of ['scale.x', 'scale.y'] as const) {
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 0, value: 0.25, easing: 'linear' })
      project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property, timeMs: 2000, value: 0.75 })
    }
    const at = (timeMs: number) => {
      const { scratch, slots } = composed(project, timeMs)
      return { scratch, slots }
    }
    expect(at(0)).toEqual({ scratch: [[1920, 1080]], slots: [[720, 405, 480, 270]] })
    expect(at(1000)).toEqual({ scratch: [[1920, 1080]], slots: [[480, 270, 960, 540]] })
  })

  test('a multicam half off the canvas copies only its on-canvas half, and one wholly off the canvas composes nothing', () => {
    expect(composed(multicam(placed(960, 0, 1)))).toEqual({
      scratch: [[1920, 1080]],
      cleared: [[960, 0, 960, 1080]],
      slots: [[960, 0, 1920, 1080]],
      copied: [[960, 0, 960, 1080]],
      landed: [[960, 0, 960, 1080]],
    })
    expect(composed(multicam(placed(3000, 0, 1)))).toEqual({ scratch: [], cleared: [], slots: [], copied: [], landed: [] })
  })

  test('a held 2x zoom draws each slot at the canvas pixels main draws it at', () => {
    const { slots, copied, landed } = composed(zoomed({}))
    expect({ slots, copied, landed }).toEqual({ slots: [[-960, -540, 3840, 2160]], copied: [[0, 0, 1920, 1080]], landed: [[0, 0, 1920, 1080]] })
  })

  test('an effect that reads neighboring pixels composes past the canvas edge, up to 8192 pixels a side', () => {
    const blur = { type: 'blur', enabled: true, radius: 4 }
    const dropShadow = { type: 'drop-shadow', enabled: true, offsetX: 0, offsetY: 8, blur: 12, color: '#000000' }
    const brightness = { type: 'brightness', enabled: true, amount: 1.2 }
    const css = { type: 'css', enabled: true, filter: 'blur(2px)' }
    const reach = (element: object) => {
      const { scratch, landed } = composed(multicam(element))
      return { scratch, landed }
    }
    expect(reach({ ...scaled(2), effects: [blur] })).toEqual({ scratch: [[3840, 2160]], landed: [[-960, -540, 3840, 2160]] })
    expect(reach({ ...scaled(2), effects: [brightness, dropShadow] })).toEqual({ scratch: [[3840, 2160]], landed: [[-960, -540, 3840, 2160]] })
    expect(reach({ ...scaled(2), effects: [css] })).toEqual({ scratch: [[3840, 2160]], landed: [[-960, -540, 3840, 2160]] })
    expect(reach({ ...scaled(8), effects: [blur] })).toEqual({ scratch: [[8192, 8192]], landed: [[-3136, -3556, 8192, 8192]] })
    expect(reach({ ...scaled(2), effects: [brightness, { ...blur, enabled: false }] })).toEqual({ scratch: [[1920, 1080]], landed: [[0, 0, 1920, 1080]] })
  })

  test('a multicam sliding in on a track transition composes where the slide draws it', () => {
    let project = applyCommand(multicam({ ...scaled(0.5), startMs: 5000 }), {
      type: 'addElement',
      trackId: 't-default',
      element: { id: 'e-prev', type: 'text', text: 'PREV', startMs: 0, durationMs: 5000 },
    })
    project = applyCommand(project, { type: 'setTransition', elementId: 'e-prev', transition: { type: 'slide-left', durationMs: 1000 } })
    expect(composed(project, 5250).landed).toEqual([[600, 270, 960, 540]])
    expect(composed(project, 6000).landed).toEqual([[480, 270, 960, 540]])
  })

  test('a slot that leaves the frame is cut at the frame, and a layout inside its frame draws without a frame clip', () => {
    const clips = (camera: LayoutSlot['rect']) => {
      const { main, scratches } = renderComposed(multicam(scaled(0.5), [{ rect: FULL }, { rect: camera }]))
      return scratches.flatMap((scratch) => onCanvas(main, scratch, 'rect'))
    }
    expect(clips({ x: 0.8, y: 0.1, w: 0.4, h: 0.3 })).toEqual([[480, 270, 960, 540]])
    expect(clips({ x: 0.6, y: 0.1, w: 0.3, h: 0.3 })).toEqual([])
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
        copied: main.callsTo('drawImage').map(deviceRect),
        clips: scratches.flatMap((scratch) => onCanvas(main, scratch, 'rect')),
        slots: scratches.flatMap((scratch) => onCanvas(main, scratch, 'drawImage')),
      }
    }
    expect(drawn({})).toEqual({
      copied: [[480, 270, 960, 540]],
      clips: [
        [480, 270, 960, 540],
        [-480, -270, 1920, 1080],
      ],
      slots: [[-480, -270, 3840, 2160]],
    })
    expect(drawn(placed(200, -100, 1.5))).toEqual({
      copied: [[440, 35, 1440, 810]],
      clips: [
        [440, 35, 1440, 810],
        [-1000, -775, 2880, 1620],
      ],
      slots: [[-1000, -775, 5760, 3240]],
    })
    expect(drawn(placed(600, 0, 1.5))).toEqual({
      copied: [[840, 135, 1080, 810]],
      clips: [
        [840, 135, 1440, 810],
        [-600, -675, 2880, 1620],
      ],
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
