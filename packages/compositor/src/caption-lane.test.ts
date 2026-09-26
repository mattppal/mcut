import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type LayoutSlot, type Project } from '@mcut/timeline'
import { getCaptionLane } from './caption-lane'

const PAD = 19.2

function multicamWith(slots: LayoutSlot[]): Project {
  let project = createProject({ width: 1920, height: 1080 })
  for (const id of ['a-screen', 'a-cam']) {
    project = applyCommand(project, { type: 'addAsset', asset: { id, kind: 'video', src: `blob:${id}`, durationMs: 60_000, width: 1920, height: 1080 } })
  }
  project = applyCommand(project, { type: 'saveLayout', layout: { id: 'l-pip', name: 'Screen + Cam', slots } })
  return applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: {
      id: 'e-mc',
      type: 'multicam',
      startMs: 0,
      durationMs: 5000,
      sources: [
        { key: 'screen', assetId: 'a-screen' },
        { key: 'camera', assetId: 'a-cam' },
      ],
      angles: [{ atMs: 0, layoutId: 'l-pip' }],
    },
  })
}

const screen: LayoutSlot = { source: 'screen', rect: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' }
const cornerHead: LayoutSlot = { source: 'camera', rect: { x: 0.82, y: 0.547, w: 0.16, h: 0.433 }, fit: 'cover' }
const edges = (lane: { centerX: number; maxWidth: number }) => ({ left: lane.centerX - lane.maxWidth / 2 - PAD, right: lane.centerX + lane.maxWidth / 2 + PAD })

describe('caption lane', () => {
  test('bottom captions stay left of a bottom-right head overlay', () => {
    const lane = edges(getCaptionLane(multicamWith([screen, cornerHead]), 1000, 'bottom', PAD))
    expect(lane.left).toBeGreaterThanOrEqual(0)
    expect(lane.right).toBeLessThan(0.82 * 1920)
    expect(lane.right - lane.left).toBeGreaterThan(0.7 * 1920)
  })

  test('a caption band the overlay does not reach keeps the full centered width', () => {
    expect(getCaptionLane(multicamWith([screen, cornerHead]), 1000, 'top', PAD)).toEqual({ centerX: 960, maxWidth: 1920 * 0.85 })
  })

  test('side by side slots are not overlays, so captions keep the full centered width', () => {
    const left: LayoutSlot = { source: 'screen', rect: { x: 0.015, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover' }
    const right: LayoutSlot = { source: 'camera', rect: { x: 0.51, y: 0.235, w: 0.475, h: 0.53 }, fit: 'cover' }
    expect(getCaptionLane(multicamWith([left, right]), 1000, 'bottom', PAD)).toEqual({ centerX: 960, maxWidth: 1920 * 0.85 })
  })
})
