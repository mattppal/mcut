import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { FakeContext2D } from './test-utils'
import type { Canvas2D, FrameSource } from './types'

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

function movingTextProject(): Project {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-mb', type: 'text', startMs: 0, durationMs: 1000, text: 'whip' },
  })
  project = applyCommand(project, {
    type: 'setKeyframe',
    elementId: 'e-mb',
    property: 'position.x',
    timeMs: 0,
    value: 0,
  })
  project = applyCommand(project, {
    type: 'setKeyframe',
    elementId: 'e-mb',
    property: 'position.x',
    timeMs: 1000,
    value: 400,
  })
  project = applyCommand(project, {
    type: 'setMotionBlur',
    elementId: 'e-mb',
    motionBlur: { enabled: true, shutterAngle: 180 },
  })
  return project
}

function scratchPair() {
  const sample = new FakeContext2D()
  const accumulate = new FakeContext2D()
  const queue = [sample, accumulate]
  return { sample, accumulate, create: () => asCtx(queue.shift() ?? accumulate) }
}

describe('motion blur', () => {
  test('renders each pass whole, adds the passes at 1/N, then composites once', () => {
    const project = movingTextProject()
    const main = new FakeContext2D()
    const { sample, accumulate, create } = scratchPair()
    renderFrame(asCtx(main), project, 500, { motionBlurSamples: 4, createScratchContext: create })

    const passes = sample.callsTo('fillText')
    expect(passes.map((p) => [p.globalAlpha, p.globalCompositeOperation])).toEqual(Array.from({ length: 4 }, () => [1, 'source-over']))
    const xs = sample.callsTo('translate').map((c) => Number(c.args[0]))
    expect(xs).toHaveLength(4)
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
    expect(xs[0]!).toBeCloseTo(960 + 197.5, 1)
    expect(xs[3]!).toBeCloseTo(960 + 202.5, 1)

    const adds = accumulate.callsTo('drawImage')
    expect(adds.map((c) => [c.args[0] === sample.canvas, c.globalAlpha, c.globalCompositeOperation])).toEqual(
      Array.from({ length: 4 }, () => [true, 0.25, 'lighter']),
    )
    expect(main.callsTo('fillText')).toHaveLength(0)
    const composites = main.callsTo('drawImage')
    expect(composites).toHaveLength(1)
    expect(composites[0]!.args[0]).toBe(accumulate.canvas)
  })

  test('renders identically regardless of evaluation order (deterministic)', () => {
    const project = movingTextProject()
    const run = () => {
      const { sample, create } = scratchPair()
      renderFrame(asCtx(new FakeContext2D()), project, 500, { motionBlurSamples: 4, createScratchContext: create })
      return sample.callsTo('translate').map((c) => c.args)
    }
    expect(run()).toEqual(run())
  })

  test('falls back to a plain render without keyframed transform motion', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { id: 'e-static', type: 'text', startMs: 0, durationMs: 1000, text: 'still' },
    })
    project = applyCommand(project, {
      type: 'setMotionBlur',
      elementId: 'e-static',
      motionBlur: { enabled: true, shutterAngle: 180 },
    })
    const main = new FakeContext2D()
    let scratchRequested = false
    renderFrame(asCtx(main), project, 500, {
      createScratchContext: () => {
        scratchRequested = true
        return null
      },
    })
    expect(scratchRequested).toBe(false)
    expect(main.callsTo('fillText')).toHaveLength(1)
  })

  test('skips the blur passes when travel inside the window is sub-pixel', () => {
    let project = movingTextProject()
    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-mb',
      property: 'position.x',
      timeMs: 1000,
      value: 2,
    })
    const main = new FakeContext2D()
    renderFrame(asCtx(main), project, 500, { createScratchContext: () => null })
    expect(main.callsTo('fillText')).toHaveLength(1)
  })

  test('element blend mode applies at the composite, not inside the passes', () => {
    let project = movingTextProject()
    project = applyCommand(project, { type: 'setBlendMode', elementId: 'e-mb', blendMode: 'screen' })
    const main = new FakeContext2D()
    const { sample, create } = scratchPair()
    renderFrame(asCtx(main), project, 500, { motionBlurSamples: 2, createScratchContext: create })
    for (const pass of sample.callsTo('fillText')) {
      expect(pass.globalCompositeOperation).toBe('source-over')
    }
    expect(main.callsTo('drawImage')[0]!.globalCompositeOperation).toBe('screen')
  })
})

const source: FrameSource = { getFrame: () => ({ width: 1280, height: 720 }) as CanvasImageSource }

function zoomedClip(opacity: number): Project {
  let project = createProject({ width: 1280, height: 720, fps: 30 })
  const trackId = project.tracks[0]?.id ?? 't-default'
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-vid', kind: 'video', src: 'blob:x', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-vid', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 5000, opacity },
  })
  return applyCommand(project, { type: 'addZoomRegion', elementId: 'e-vid', zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, motionBlur: 1 } })
}

function zoomedMulticam(): Project {
  let project = createProject({ width: 1280, height: 720, fps: 30 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-vid', kind: 'video', src: 'blob:x', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, {
    type: 'saveLayout',
    layout: { id: 'l-full', name: 'Full', slots: [{ source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 } }] },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: [{ key: 'screen', assetId: 'a-vid' }],
      angles: [{ atMs: 0, layoutId: 'l-full' }],
    },
  })
  return applyCommand(project, {
    type: 'addZoomRegion',
    elementId: 'e-mc',
    zoom: { atMs: 0, inMs: 1000, holdMs: 1000, outMs: 1000, scale: 2, motionBlur: 1, source: 'screen' },
  })
}

describe('zoom motion blur', () => {
  test('a ramp renders zooming passes whole and adds them at 1/N, keeping the clip opacity inside each pass', () => {
    const main = new FakeContext2D()
    const { sample, accumulate, create } = scratchPair()
    renderFrame(asCtx(main), zoomedClip(0.5), 100, { source, motionBlurSamples: 4, createScratchContext: create })
    const passes = sample.callsTo('drawImage')
    expect(passes.map((p) => [p.globalAlpha, p.globalCompositeOperation])).toEqual(Array.from({ length: 4 }, () => [0.5, 'source-over']))
    const widths = passes.map((p) => Number(p.args[3]))
    for (let i = 1; i < widths.length; i++) expect(widths[i] ?? 0).toBeLessThan(widths[i - 1] ?? 0)
    expect(accumulate.callsTo('drawImage').map((c) => [c.globalAlpha, c.globalCompositeOperation])).toEqual(Array.from({ length: 4 }, () => [0.25, 'lighter']))
    expect(main.callsTo('drawImage')).toHaveLength(1)
  })

  test('at renderScale 0.5 the passes render at half scale into half-size scratch and composite over the whole frame', () => {
    const main = new FakeContext2D()
    const { sample, accumulate, create } = scratchPair()
    const sizes: number[][] = []
    const createScratchContext = (width: number, height: number) => {
      sizes.push([width, height])
      return create()
    }
    renderFrame(asCtx(main), zoomedClip(1), 100, { source, motionBlurSamples: 4, renderScale: 0.5, createScratchContext })
    expect(sizes).toEqual([
      [640, 360],
      [640, 360],
    ])
    expect(sample.callsTo('setTransform').map((c) => c.args)).toEqual([[0.5, 0, 0, 0.5, 0, 0]])
    expect(main.callsTo('drawImage').map((c) => [c.args[0] === accumulate.canvas, ...c.args.slice(1)])).toEqual([[true, 0, 0, 1280, 720]])
  })

  test('a multicam inside a half-scale pass composes at half size', () => {
    const sizes: number[][] = []
    const createScratchContext = (width: number, height: number) => {
      sizes.push([width, height])
      return asCtx(new FakeContext2D(width, height))
    }
    renderFrame(asCtx(new FakeContext2D()), zoomedMulticam(), 100, { source, motionBlurSamples: 4, renderScale: 0.5, createScratchContext })
    expect(sizes).toEqual(Array.from({ length: 6 }, () => [640, 360]))
  })

  test('a hold draws one sharp pass straight into the frame', () => {
    const main = new FakeContext2D()
    const { sample, create } = scratchPair()
    renderFrame(asCtx(main), zoomedClip(1), 1500, { source, createScratchContext: create })
    expect(sample.callsTo('drawImage')).toHaveLength(0)
    expect(main.callsTo('drawImage').map((p) => p.args[3])).toEqual([640])
  })
})
