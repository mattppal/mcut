import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { FakeContext2D } from './test-utils'
import type { Canvas2D, FrameSource } from './types'

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

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

describe('zoom motion blur', () => {
  test('a ramp accumulates zooming passes in the scratch and composites once, keeping the clip opacity', () => {
    const main = new FakeContext2D()
    const scratch = new FakeContext2D()
    renderFrame(asCtx(main), zoomedClip(0.5), 100, { source, motionBlurSamples: 4, createScratchContext: () => asCtx(scratch) })
    const passes = scratch.callsTo('drawImage')
    expect(passes.map((p) => [p.globalAlpha, p.globalCompositeOperation])).toEqual([
      [0.125, 'lighter'],
      [0.125, 'lighter'],
      [0.125, 'lighter'],
      [0.125, 'lighter'],
    ])
    const widths = passes.map((p) => p.args[3] as number)
    for (let i = 1; i < widths.length; i++) expect(widths[i] ?? 0).toBeLessThan(widths[i - 1] ?? 0)
    expect(main.callsTo('drawImage')).toHaveLength(1)
  })

  test('a hold draws one sharp pass straight into the frame', () => {
    const main = new FakeContext2D()
    const scratch = new FakeContext2D()
    renderFrame(asCtx(main), zoomedClip(1), 1500, { source, createScratchContext: () => asCtx(scratch) })
    expect(scratch.callsTo('drawImage')).toHaveLength(0)
    expect(main.callsTo('drawImage').map((p) => p.args[3])).toEqual([640])
  })
})
