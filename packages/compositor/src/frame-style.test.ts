import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import { getElementDisplaySize, getElementNaturalSize } from './geometry'
import { renderFrame } from './render-frame'
import { FakeContext2D } from './test-utils'
import type { Canvas2D, FrameSource } from './types'

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

const frameCalls = (fake: FakeContext2D) =>
  fake.calls
    .filter((c) => c.method === 'roundRect' || c.method === 'clip' || c.method === 'fill' || c.method === 'stroke')
    .map((c) => (c.method === 'fill' ? { method: c.method, shadow: c.shadow } : { method: c.method, args: c.args }))

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
    const slot = new FakeContext2D()
    renderFrame(asCtx(slot), projectWithMulticam({ width: 1280, height: 720 }, style), 1000, { source: new FakeSource() })
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
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    expect(ctx.callsTo('drawImage').map((c) => c.args.slice(1))).toEqual([[320, 90, 320, 180, -960, -540, 1920, 1080]])
  })

  test('a slot zoom frames its target inside the slot crop, out to the crop edges', () => {
    const drawAt = (focus: { x: number; y: number }) => {
      const cropped = projectWithMulticam({ width: 1920, height: 1080 }, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } })
      const project = applyCommand(cropped, {
        type: 'addZoomRegion',
        elementId: 'e-mc',
        zoom: { source: 'camera', atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, focus },
      })
      const ctx = new FakeContext2D()
      renderFrame(asCtx(ctx), project, 1500, { source: new FakeSource() })
      return ctx.callsTo('drawImage').map((c) => c.args.slice(1))
    }
    expect(drawAt({ x: 1, y: 1 })).toEqual([[480, 270, 160, 90, -960, -540, 1920, 1080]])
    expect(drawAt({ x: 0, y: 0 })).toEqual([[320, 0, 160, 90, -960, -540, 1920, 1080]])
  })

  test('a multicam zoom without a source scales the whole composite toward its focus and leaves slot framing alone', () => {
    const base = projectWithMulticam({ width: 1920, height: 1080 }, {})
    const project = applyCommand(base, {
      type: 'addZoomRegion',
      elementId: 'e-mc',
      zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, focus: { x: 1, y: 1 } },
    })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1500, { source: new FakeSource() })
    expect(ctx.callsTo('scale').at(-1)?.args).toEqual([2, 2])
    expect(ctx.callsTo('translate').at(-1)?.args).toEqual([-960, -540])
    expect(ctx.callsTo('drawImage').map((c) => c.args.slice(1))).toEqual([[0, 0, 640, 360, -960, -540, 1920, 1080]])
  })

  test('a whole-composite zoom mid ramp crops the anchored window around a picture-in-picture slot', () => {
    const base = projectWithMulticam({ width: 1920, height: 1080 }, { rect: { x: 0.7, y: 0.69, w: 0.275, h: 0.275 } })
    const project = applyCommand(base, {
      type: 'addZoomRegion',
      elementId: 'e-mc',
      zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 1.5, focus: { x: 0.84, y: 0.83 }, easing: 'linear' },
    })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 500, { source: new FakeSource() })
    const last = (method: string) => (ctx.callsTo(method).at(-1)?.args ?? []).map((v) => Math.round(Number(v) * 1e6) / 1e6)
    expect(last('rect')).toEqual([-960, -540, 1920, 1080])
    expect(last('translate')).toEqual([-120, -67.5])
    expect(last('scale')).toEqual([1.25, 1.25])
    expect(last('drawImage').slice(1)).toEqual([0, 0, 640, 360, 384, 205.2, 528, 297])
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
    const sourceRectsAt = (timeMs: number) => {
      const ctx = new FakeContext2D()
      renderFrame(asCtx(ctx), project, timeMs, { source: new FakeSource() })
      return ctx.callsTo('drawImage').map((c) => c.args.slice(1, 5))
    }
    expect(sourceRectsAt(0)).toEqual([[80, 90, 320, 180]])
    expect(sourceRectsAt(4000)).toEqual([[80, 0, 320, 180]])
  })

  test('a multicam draws its own crop and corner radius around the composite', () => {
    const project = projectWithMulticam({ width: 1920, height: 1080 }, {}, { cornerRadius: 0.1, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1000, { source: new FakeSource() })
    expect(ctx.callsTo('roundRect').map((c) => c.args)).toEqual([[-480, -270, 960, 540, 54]])
    expect(ctx.callsTo('rect').map((c) => c.args)).toEqual([[-480, -270, 960, 540]])
    expect(ctx.callsTo('translate').at(-1)?.args).toEqual([-480, -270])
    expect(ctx.callsTo('drawImage').map((c) => c.args.slice(5))).toEqual([[-960, -540, 1920, 1080]])
  })

  test('crop shrinks natural and display size for layout/handles', () => {
    const project = projectWithVideo({ crop: { x: 0, y: 0, w: 0.5, h: 0.25 } })
    const element = project.tracks[0]!.elements[0]!
    const helpers = {
      getAssetSize: () => ({ width: 1280, height: 720 }),
    }
    expect(getElementNaturalSize(element, helpers)).toEqual({ width: 640, height: 180 })
    expect(getElementDisplaySize(element, helpers)).toEqual({ width: 640, height: 180 })
  })
})
