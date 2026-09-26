import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import type { ImageQuad, LayerChrome, RenderBackend } from './backend'
import { getElementDisplaySize, getElementNaturalSize } from './geometry'
import { renderFrame, renderFrameWith } from './render-frame'
import { FakeContext2D, type RecordedCall } from './test-utils'
import type { Canvas2D, FrameSource } from './types'
import { COLOR_OP, planEffects } from './webgpu/effect-plan'

class FakeSource implements FrameSource {
  getFrame(): CanvasImageSource | null {
    return { width: 640, height: 360 } as CanvasImageSource
  }
}

function projectWithVideo(patch: Record<string, unknown> = {}): Project {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:x', durationMs: 60_000, width: 1280, height: 720 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-vid', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 5000 },
  })
  if (Object.keys(patch).length > 0) {
    project = applyCommand(project, { type: 'updateElement', elementId: 'e-vid', patch })
  }
  return project
}

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

function projectWithMulticam(size: { width: number; height: number }, slot: Partial<LayoutSlot>, element: object = {}): Project {
  let project = createProject(size)
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
  const full = { x: 0, y: 0, w: 1, h: 1 }
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-cam', name: 'Camera', slots: [{ source: 'camera', rect: full, ...slot }] } })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: [{ key: 'camera', assetId: 'a-cam' }],
      angles: [{ atMs: 0, layoutId: 'l-cam' }],
      ...element,
    },
  })
}

function screenWithCamera(): Project {
  const sources = [
    { key: 'screen', assetId: 'a-cam' },
    { key: 'camera', assetId: 'a-cam' },
  ]
  const slots = [
    { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { source: 'camera', rect: { x: 0.75, y: 0.75, w: 0.25, h: 0.25 } },
  ]
  const project = projectWithMulticam({ width: 1920, height: 1080 }, {}, { sources })
  return applyCommand(project, { type: 'saveLayout', layout: { id: 'l-cam', name: 'Screen + Cam', slots } })
}

function renderComposed(project: Project, timeMs = 1000): { main: FakeContext2D; composed: FakeContext2D } {
  const main = new FakeContext2D()
  const composed = new FakeContext2D(project.width, project.height)
  renderFrame(asCtx(main), project, timeMs, { source: new FakeSource(), createScratchContext: () => asCtx(composed) })
  return { main, composed }
}

const frameCalls = (fake: FakeContext2D) =>
  fake.calls
    .filter((c) => c.method === 'roundRect' || c.method === 'clip' || c.method === 'fill' || c.method === 'stroke')
    .map((c) => (c.method === 'fill' ? { method: c.method, shadow: c.shadow } : { method: c.method, args: c.args }))

const deviceRect = ({ args, transform: { a, b, c, d, e, f } }: RecordedCall) => {
  const [x = 0, y = 0, w = 0, h = 0] = args.slice(-4).map(Number)
  const at = (px: number, py: number) => ({ x: a * px + c * py + e, y: b * px + d * py + f })
  const from = at(x, y)
  const to = at(x + w, y + h)
  return [from.x, from.y, to.x - from.x, to.y - from.y]
}

describe('frame style rendering', () => {
  test('crop draws the kept source region into the shrunken frame', () => {
    const project = projectWithVideo({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    const draw = ctx.callsTo('drawImage').at(-1)!
    expect(draw.args.slice(1, 5)).toEqual([160, 90, 320, 180])
    expect(draw.args.slice(5)).toEqual([-320, -180, 640, 360])
  })

  test('a reframe track slides the crop window onto the subject and stops at the frame edge', () => {
    const project = applyCommand(projectWithVideo(), {
      type: 'setReframe',
      elementId: 'e-vid',
      crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      track: [
        { sourceMs: 0, x: 0.375, y: 0.5 },
        { sourceMs: 4000, x: 0.9, y: 0.5 },
      ],
    })
    const sourceRectAt = (timeMs: number) => {
      const ctx = new FakeContext2D()
      renderFrame(asCtx(ctx), project, timeMs, { source: new FakeSource() })
      return ctx.callsTo('drawImage').at(-1)?.args.slice(1, 5)
    }
    expect(sourceRectAt(0)).toEqual([80, 0, 320, 360])
    expect(sourceRectAt(4000)).toEqual([320, 0, 320, 360])
  })

  test('a zoom region narrows from the reframed crop window', () => {
    const reframed = applyCommand(projectWithVideo(), {
      type: 'setReframe',
      elementId: 'e-vid',
      crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      track: [{ sourceMs: 0, x: 0.375, y: 0.5 }],
    })
    const project = applyCommand(reframed, { type: 'addZoomRegion', elementId: 'e-vid', zoom: { atMs: 0, inMs: 500, holdMs: 2000, outMs: 500, scale: 2 } })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    expect(ctx.callsTo('drawImage').at(-1)?.args.slice(1, 5)).toEqual([160, 90, 160, 180])
  })

  test('cornerRadius clips the draw to a rounded rect', () => {
    const project = projectWithVideo({ cornerRadius: 0.1 })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    const round = ctx.callsTo('roundRect').at(-1)!
    expect(round.args).toEqual([-640, -360, 1280, 720, 72])
    expect(ctx.callsTo('clip').length).toBeGreaterThan(0)
  })

  test('stroke paints an inside border after the content', () => {
    const project = projectWithVideo({ stroke: { color: '#ffffff', width: 8 } })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    expect(ctx.callsTo('stroke')).toHaveLength(1)
    const drawIndex = ctx.calls.findIndex((c) => c.method === 'drawImage')
    const strokeIndex = ctx.calls.findIndex((c) => c.method === 'stroke')
    expect(strokeIndex).toBeGreaterThan(drawIndex)
  })

  test('shadow fills the frame rect before the content draws', () => {
    const project = projectWithVideo({
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 24, offsetX: 0, offsetY: 10 },
    })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    const fillIndex = ctx.calls.findIndex((c) => c.method === 'fill')
    const drawIndex = ctx.calls.findIndex((c) => c.method === 'drawImage')
    expect(fillIndex).toBeGreaterThanOrEqual(0)
    expect(fillIndex).toBeLessThan(drawIndex)
  })

  test('plain elements keep the 5-arg fast path', () => {
    const project = projectWithVideo()
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    const draw = ctx.callsTo('drawImage').at(-1)!
    expect(draw.args).toHaveLength(5)
    expect(ctx.callsTo('stroke')).toHaveLength(0)
  })

  test('a slot and a video clip with the same frame style draw the same frame', () => {
    const style = {
      cornerRadius: 0.1,
      stroke: { color: '#ffffff', width: 4 },
      shadow: { color: 'rgba(0,0,0,0.5)', blur: 20, offsetX: 0, offsetY: 8 },
    }
    const clip = new FakeContext2D()
    renderFrame(asCtx(clip), projectWithVideo(style), 1000, { source: new FakeSource() })
    const slot = renderComposed(projectWithMulticam({ width: 1280, height: 720 }, style)).composed
    const box = [-640, -360, 1280, 720, 72]
    expect(frameCalls(slot)).toEqual([
      { method: 'roundRect', args: box },
      { method: 'fill', shadow: style.shadow },
      { method: 'roundRect', args: box },
      { method: 'clip', args: [] },
      { method: 'roundRect', args: box },
      { method: 'clip', args: [] },
      { method: 'roundRect', args: box },
      { method: 'stroke', args: [] },
    ])
    expect(frameCalls(clip)).toEqual(frameCalls(slot))
  })

  test('a slot crop picks the source region that covers the slot', () => {
    const project = projectWithMulticam({ width: 1920, height: 1080 }, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })
    const { composed } = renderComposed(project)
    expect(composed.callsTo('drawImage').map((c) => c.args.slice(1))).toEqual([[320, 90, 320, 180, -960, -540, 1920, 1080]])
  })

  test('a slot zoom frames its target inside the slot crop, out to the crop edges', () => {
    const drawAt = (focus: { x: number; y: number }) => {
      const cropped = projectWithMulticam({ width: 1920, height: 1080 }, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })
      const project = applyCommand(cropped, {
        type: 'addZoomRegion',
        elementId: 'e-mc',
        zoom: { source: 'camera', atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, focus },
      })
      return renderComposed(project, 1500)
        .composed.callsTo('drawImage')
        .map((c) => c.args.slice(1))
    }
    expect(drawAt({ x: 1, y: 1 })).toEqual([[480, 270, 160, 90, -960, -540, 1920, 1080]])
    expect(drawAt({ x: 0, y: 0 })).toEqual([[320, 0, 160, 90, -960, -540, 1920, 1080]])
  })

  test('a multicam zoom without a source scales the whole composite toward its focus inside the element crop and leaves slot framing alone', () => {
    const zoomedAt = (focus: { x: number; y: number }, element: object = {}) => {
      const base = projectWithMulticam({ width: 1920, height: 1080 }, {}, element)
      const project = applyCommand(base, {
        type: 'addZoomRegion',
        elementId: 'e-mc',
        zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, focus },
      })
      const { main, composed } = renderComposed(project, 1500)
      return {
        slots: composed.callsTo('drawImage').map((c) => c.args.slice(1)),
        frame: main.callsTo('drawImage').map((c) => [c.args[0] === composed.canvas, ...c.args.slice(1)]),
      }
    }
    expect(zoomedAt({ x: 1, y: 1 })).toEqual({
      slots: [[0, 0, 640, 360, -960, -540, 1920, 1080]],
      frame: [[true, 960, 540, 960, 540, -960, -540, 1920, 1080]],
    })
    expect(zoomedAt({ x: 0, y: 0 }, { crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }).frame).toEqual([[true, 960, 540, 480, 270, -480, -270, 960, 540]])
  })

  test('a whole-composite zoom mid ramp crops the anchored window around a picture-in-picture slot', () => {
    const base = projectWithMulticam({ width: 1920, height: 1080 }, { rect: { x: 0.7, y: 0.69, w: 0.275, h: 0.275 } })
    const project = applyCommand(base, {
      type: 'addZoomRegion',
      elementId: 'e-mc',
      zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 1.5, focus: { x: 0.84, y: 0.83 }, easing: 'linear', motionBlur: 0 },
    })
    const { main, composed } = renderComposed(project, 500)
    const rounded = (args: unknown[]) => args.map((v) => Math.round(Number(v) * 1e6) / 1e6)
    expect(composed.callsTo('drawImage').map((c) => rounded(c.args.slice(1)))).toEqual([[0, 0, 640, 360, 384, 205.2, 528, 297]])
    expect(main.callsTo('drawImage').map((c) => [c.args[0] === composed.canvas, ...rounded(c.args.slice(1))])).toEqual([
      [true, 288, 162, 1536, 864, -960, -540, 1920, 1080],
    ])
  })

  test('a reframe track slides a slot crop onto the subject, and the fitted part keeps following once the crop meets the frame edge', () => {
    const cropped = projectWithMulticam({ width: 1920, height: 1080 }, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })
    const project = applyCommand(cropped, {
      type: 'setReframe',
      elementId: 'e-mc',
      source: 'camera',
      track: [
        { sourceMs: 0, x: 0.375, y: 0.5 },
        { sourceMs: 4000, x: 0.375, y: 0.1 },
      ],
    })
    const sourceRectsAt = (timeMs: number) =>
      renderComposed(project, timeMs)
        .composed.callsTo('drawImage')
        .map((c) => c.args.slice(1, 5))
    expect(sourceRectsAt(0)).toEqual([[80, 90, 320, 180]])
    expect(sourceRectsAt(4000)).toEqual([[80, 0, 320, 180]])
  })

  test('a multicam crop and corner radius cut and round the composed frame the way they do a clip', () => {
    const project = projectWithMulticam({ width: 1920, height: 1080 }, {}, { cornerRadius: 0.1, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    const { main, composed } = renderComposed(project)
    expect(composed.callsTo('drawImage').map((c) => c.args.slice(5))).toEqual([[-960, -540, 1920, 1080]])
    expect(frameCalls(main)).toEqual([
      { method: 'roundRect', args: [-480, -270, 960, 540, 54] },
      { method: 'clip', args: [] },
    ])
    expect(main.callsTo('drawImage').map((c) => [c.args[0] === composed.canvas, ...c.args.slice(1)])).toEqual([
      [true, 960, 540, 960, 540, -480, -270, 960, 540],
    ])
  })

  test('crop shrinks natural and display size for layout/handles', () => {
    const project = projectWithVideo({ crop: { x: 0, y: 0, w: 0.5, h: 0.25 } })
    const element = project.tracks[0]!.elements[0]!
    const helpers = {
      getAssetSize: () => ({ width: 1280, height: 720 }),
    }
    expect(getElementNaturalSize(project, element, helpers)).toEqual({ width: 640, height: 180 })
    expect(getElementDisplaySize(project, element, helpers)).toEqual({ width: 640, height: 180 })
  })
})

class RecordingBackend implements RenderBackend {
  readonly kind = 'recording'
  readonly width = 1920
  readonly height = 1080
  readonly renderScale = 1
  readonly raster = new FakeContext2D()
  readonly quads: Array<{ quad: ImageQuad; chrome: LayerChrome }> = []
  beginFrame(): void {}
  endFrame(): void {}
  acquireRaster(): Canvas2D {
    return asCtx(this.raster)
  }
  drawImageQuad(quad: ImageQuad, chrome: LayerChrome): void {
    this.quads.push({ quad, chrome })
  }
  pushRasterScope(): void {}
  popRasterScope(): void {}
}

describe('multicam composite', () => {
  const multiply = (project: Project, elementId: string) => applyCommand(project, { type: 'setBlendMode', elementId, blendMode: 'multiply' })

  test('a multicam blends its composed frame once, the way a clip with the same blend does', () => {
    const clip = new FakeContext2D()
    renderFrame(asCtx(clip), multiply(projectWithVideo(), 'e-vid'), 1000, { source: new FakeSource() })
    const { main, composed } = renderComposed(multiply(screenWithCamera(), 'e-mc'))
    const modes = (fake: FakeContext2D) => fake.callsTo('drawImage').map((c) => c.globalCompositeOperation)
    expect(modes(clip)).toEqual(['multiply'])
    expect(modes(main)).toEqual(['multiply'])
    expect(modes(composed)).toEqual(['source-over', 'source-over'])
  })

  test('a multicam composes at the render scale of its target', () => {
    const composeAt = (scale: number) => {
      const main = new FakeContext2D(1920 * scale, 1080 * scale)
      main.setTransform(scale, 0, 0, scale, 0, 0)
      let composed = new FakeContext2D()
      renderFrame(asCtx(main), screenWithCamera(), 1000, {
        source: new FakeSource(),
        createScratchContext: (width, height) => {
          composed = new FakeContext2D(width, height)
          return asCtx(composed)
        },
      })
      return {
        scratch: composed.canvas,
        slots: composed.callsTo('drawImage').map(deviceRect),
        frame: main.callsTo('drawImage').map((c) => [c.args[0] === composed.canvas, ...deviceRect(c)]),
      }
    }
    expect(composeAt(2)).toEqual({
      scratch: { width: 3840, height: 2160 },
      slots: [
        [0, 0, 3840, 2160],
        [2880, 1620, 960, 540],
      ],
      frame: [[true, 0, 0, 3840, 2160]],
    })
    expect(composeAt(0.5)).toEqual({
      scratch: { width: 960, height: 540 },
      slots: [
        [0, 0, 960, 540],
        [720, 405, 240, 135],
      ],
      frame: [[true, 0, 0, 960, 540]],
    })
    expect(composeAt(0).scratch).toEqual({ width: 1, height: 1 })
  })

  test('a keyed multicam reaches the backend as one image quad with the chrome of a keyed clip, off the raster', () => {
    const keyed = (project: Project, elementId: string) =>
      multiply(applyCommand(project, { type: 'addEffect', elementId, effect: { type: 'chroma-key' } }), elementId)
    const clip = new RecordingBackend()
    renderFrameWith(clip, keyed(projectWithVideo(), 'e-vid'), 1000, { source: new FakeSource() })
    const multicam = new RecordingBackend()
    const composed = new FakeContext2D()
    renderFrameWith(multicam, keyed(screenWithCamera(), 'e-mc'), 1000, { source: new FakeSource(), createScratchContext: () => asCtx(composed) })

    const chrome: LayerChrome = {
      centerX: 960,
      centerY: 540,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      blendMode: 'multiply',
      effects: [{ type: 'chroma-key', enabled: true, keyColor: '#00ff00', tolerance: 0.25, softness: 0.1, spillSuppression: 0.5 }],
    }
    expect(clip.quads.map((q) => q.chrome)).toEqual([chrome])
    expect(multicam.quads.map((q) => q.chrome)).toEqual([chrome])
    expect(multicam.quads.map(({ quad }) => [quad.image === composed.canvas, quad.src, quad.dw, quad.dh])).toEqual([[true, null, 1920, 1080]])
    expect(multicam.raster.calls).toEqual([])
    expect(composed.callsTo('drawImage')).toHaveLength(2)

    const plan = planEffects(multicam.quads[0]?.chrome.effects)
    const pass = plan.passes[0]
    if (pass?.kind !== 'color') throw new Error('expected color pass')
    expect(plan.unsupported).toBe(false)
    expect(pass.ops[0]?.kind).toBe(COLOR_OP.chromaKey)
    expect(pass.ops[0]?.params.slice(0, 6)).toEqual([0, 1, 0, 0.25, 0.1, 0.5])
  })
})
