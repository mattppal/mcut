import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
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
