import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject, type Project } from './model'
import { collectSnapTargets, nearestSnapTarget, snapClip, snapTime } from './snap'

function projectWithClips(): Project {
  let project = createProject({ fps: 30 })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-a', type: 'text', text: 'a', startMs: 1000, durationMs: 2000 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-b', type: 'text', text: 'b', startMs: 5000, durationMs: 1000 },
  })
  project = applyCommand(project, { type: 'addMarker', id: 'm-1', timeMs: 4200 })
  return project
}

describe('collectSnapTargets', () => {
  test('collects origin, markers, clip edges, and the playhead, sorted', () => {
    const targets = collectSnapTargets(projectWithClips(), { playheadMs: 2500 })
    expect(targets.map((t) => t.timeMs)).toEqual([0, 1000, 2500, 3000, 4200, 5000, 6000])
    expect(targets.find((t) => t.timeMs === 4200)?.kind).toBe('marker')
    expect(targets.find((t) => t.timeMs === 2500)?.kind).toBe('playhead')
    expect(targets.find((t) => t.timeMs === 1000)?.kind).toBe('clip-start')
    expect(targets.find((t) => t.timeMs === 6000)?.kind).toBe('clip-end')
  })

  test('excludes the dragged elements edges', () => {
    const targets = collectSnapTargets(projectWithClips(), {
      excludeElementIds: new Set(['e-a']),
    })
    expect(targets.map((t) => t.timeMs)).toEqual([0, 4200, 5000, 6000])
  })
})

describe('snapTime', () => {
  const targets = collectSnapTargets(projectWithClips())

  test('snaps to the nearest target within threshold', () => {
    expect(snapTime(3080, targets, 100)).toMatchObject({ ms: 3000, guideMs: 3000 })
    expect(snapTime(4150, targets, 100).target?.kind).toBe('marker')
  })

  test('passes through outside the threshold', () => {
    expect(snapTime(3500, targets, 100)).toMatchObject({ ms: 3500, guideMs: null, target: null })
  })

  test('disabled snapping still frame-quantizes when fps is given', () => {
    const result = snapTime(3005, targets, 100, { enabled: false, fps: 30 })
    expect(result.guideMs).toBeNull()
    // 3005ms at 30fps → frame 90 → 3000ms
    expect(result.ms).toBe(3000)
  })

  test('un-snapped times frame-quantize when fps is given', () => {
    const result = snapTime(3521, targets, 100, { fps: 30 })
    expect(result.guideMs).toBeNull()
    expect(result.ms).toBe(3533) // frame 106 at 30fps
  })
})

describe('nearestSnapTarget', () => {
  const targets = collectSnapTargets(projectWithClips())

  test('binary search finds the closer neighbor on both sides', () => {
    expect(nearestSnapTarget(990, targets, 50)?.timeMs).toBe(1000)
    expect(nearestSnapTarget(1010, targets, 50)?.timeMs).toBe(1000)
    expect(nearestSnapTarget(0, targets, 50)?.timeMs).toBe(0)
    expect(nearestSnapTarget(6500, targets, 600)?.timeMs).toBe(6000)
    expect(nearestSnapTarget(6500, targets, 100)).toBeNull()
  })
})

describe('snapClip', () => {
  const targets = collectSnapTargets(projectWithClips(), {
    excludeElementIds: new Set(['e-b']),
  })

  test('the closer edge wins and the clip shifts to land it on the target', () => {
    // Clip end at 4030 is within 50 of nothing; start at 3030 is within 50 of 3000.
    expect(snapClip(3030, 1000, targets, 50)).toMatchObject({ ms: 3000, edge: 'start' })
    // End edge near a target: start 2050 → end 3050, snaps end to 3000.
    expect(snapClip(2050, 1000, targets, 60)).toMatchObject({ ms: 2000, guideMs: 3000, edge: 'end' })
  })

  test('no target within threshold passes through (frame-quantized with fps)', () => {
    expect(snapClip(3490, 100, targets, 10)).toMatchObject({ ms: 3490, edge: null })
    expect(snapClip(3491, 100, targets, 10, { fps: 30 })).toMatchObject({ ms: 3500, edge: null })
  })

  test('disabled returns the input untouched without fps', () => {
    expect(snapClip(3030, 1000, targets, 50, { enabled: false })).toMatchObject({
      ms: 3030,
      guideMs: null,
      edge: null,
    })
  })
})
