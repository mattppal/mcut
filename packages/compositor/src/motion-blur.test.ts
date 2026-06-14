import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { FakeContext2D } from './test-utils'
import type { Canvas2D } from './types'

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

/** Text clip whose position.x sweeps 0 → 400 across 1s, with motion blur on. */
function movingTextProject(): Project {
  let project = createProject() // 1920×1080 @ 30fps
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

describe('motion blur', () => {
  test('accumulates N sub-frame passes additively, then composites once', () => {
    const project = movingTextProject()
    const main = new FakeContext2D()
    const scratch = new FakeContext2D()
    renderFrame(asCtx(main), project, 500, {
      motionBlurSamples: 4,
      createScratchContext: () => asCtx(scratch),
    })

    // Four passes in the scratch, each at 1/4 alpha, accumulated additively.
    const passes = scratch.callsTo('fillText')
    expect(passes).toHaveLength(4)
    for (const pass of passes) {
      expect(pass.globalAlpha).toBeCloseTo(0.25, 5)
      expect(pass.globalCompositeOperation).toBe('lighter')
    }

    // The transform sweeps across the shutter window: at 30fps and 180°,
    // ±8.33ms around the frame at 0.4px/ms → ~6.7px of travel, centered.
    const xs = scratch.callsTo('translate').map((c) => c.args[0] as number)
    expect(xs).toHaveLength(4)
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
    expect(xs[0]!).toBeCloseTo(960 + 197.5, 1)
    expect(xs[3]!).toBeCloseTo(960 + 202.5, 1)

    // Nothing drawn directly on the main ctx; one composite of the scratch.
    expect(main.callsTo('fillText')).toHaveLength(0)
    const composites = main.callsTo('drawImage')
    expect(composites).toHaveLength(1)
    expect(composites[0]!.args[0]).toBe(scratch.canvas)
    // Scratch state restored after accumulation.
    expect(scratch.globalCompositeOperation).toBe('source-over')
    expect(scratch.globalAlpha).toBe(1)
  })

  test('renders identically regardless of evaluation order (deterministic)', () => {
    const project = movingTextProject()
    const run = () => {
      const scratch = new FakeContext2D()
      renderFrame(asCtx(new FakeContext2D()), project, 500, {
        motionBlurSamples: 4,
        createScratchContext: () => asCtx(scratch),
      })
      return scratch.callsTo('translate').map((c) => c.args)
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
    // Replace the sweep with a crawl: 2px over the whole second.
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
    const scratch = new FakeContext2D()
    renderFrame(asCtx(main), project, 500, {
      motionBlurSamples: 2,
      createScratchContext: () => asCtx(scratch),
    })
    for (const pass of scratch.callsTo('fillText')) {
      expect(pass.globalCompositeOperation).toBe('lighter')
    }
    expect(main.callsTo('drawImage')[0]!.globalCompositeOperation).toBe('screen')
  })
})
