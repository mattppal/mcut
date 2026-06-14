import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import {
  getAverageSpeed,
  getSourceSpanMs,
  getSourceTimeMs,
  getSpeedAt,
  makeConstantSpeedMap,
  splitTimeMap,
  timeMapSchema,
} from './speed'

function projectWithVideo(): { project: Project; trackId: `t-${string}` } {
  let project = createProject({ name: 'speed' })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-v', assetId: 'a-vid', startMs: 0, durationMs: 4000 },
  })
  return { project, trackId }
}

describe('timeMap schema', () => {
  test('rejects non-monotone values and times', () => {
    expect(() =>
      timeMapSchema.parse([
        { timeMs: 0, value: 100 },
        { timeMs: 1000, value: 50 },
      ]),
    ).toThrow()
    expect(() =>
      timeMapSchema.parse([
        { timeMs: 1000, value: 0 },
        { timeMs: 1000, value: 50 },
      ]),
    ).toThrow()
    expect(
      timeMapSchema.parse([
        { timeMs: 0, value: 0 },
        { timeMs: 1000, value: 0 }, // freeze is fine
      ]),
    ).toHaveLength(2)
  })
})

describe('source time mapping', () => {
  const base = { startMs: 0, durationMs: 2000, trimStartMs: 500 }

  test('without a map: trim + local', () => {
    expect(getSourceTimeMs(base, 250)).toBe(750)
    expect(getSourceSpanMs(base)).toBe(2000)
    expect(getAverageSpeed(base)).toBe(1)
    expect(getSpeedAt(base, 100)).toBe(1)
  })

  test('constant 2x map', () => {
    const el = { ...base, timeMap: makeConstantSpeedMap(2000, 2) }
    expect(getSourceTimeMs(el, 0)).toBe(500)
    expect(getSourceTimeMs(el, 1000)).toBe(2500)
    expect(getSourceSpanMs(el)).toBe(4000)
    expect(getAverageSpeed(el)).toBe(2)
    expect(getSpeedAt(el, 1000)).toBeCloseTo(2, 5)
  })

  test('freeze segment has zero speed', () => {
    const el = {
      ...base,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 1000, value: 1000 },
        { timeMs: 1500, value: 1000 }, // freeze
        { timeMs: 2000, value: 1500 },
      ],
    }
    expect(getSourceTimeMs(el, 1250)).toBe(1500) // 500 trim + 1000 frozen
    expect(getSpeedAt(el, 1250)).toBe(0)
    expect(getSpeedAt(el, 500)).toBeCloseTo(1, 5)
  })
})

describe('setElementSpeed command', () => {
  test('2x halves the duration and writes a linear map', () => {
    const { project } = projectWithVideo()
    const next = applyCommand(project, { type: 'setElementSpeed', elementId: 'e-v', speed: 2 })
    const video = getElement(next, 'e-v' as `e-${string}`) as VideoElement
    expect(video.durationMs).toBe(2000)
    expect(video.timeMap).toEqual([
      { timeMs: 0, value: 0 },
      { timeMs: 2000, value: 4000 },
    ])
    // Back to 1x removes the map and restores the duration.
    const restored = applyCommand(next, { type: 'setElementSpeed', elementId: 'e-v', speed: 1 })
    const videoRestored = getElement(restored, 'e-v' as `e-${string}`) as VideoElement
    expect(videoRestored.durationMs).toBe(4000)
    expect(videoRestored.timeMap).toBeUndefined()
  })

  test('slow motion past the asset end is allowed; speedups past it are not', () => {
    const { project } = projectWithVideo()
    // 0.5x: duration 8000, source span still 4000 <= 10000. OK.
    const slow = applyCommand(project, { type: 'setElementSpeed', elementId: 'e-v', speed: 0.5 })
    expect((getElement(slow, 'e-v' as `e-${string}`) as VideoElement).durationMs).toBe(8000)
    // Trim to the asset tail, then 2x is still within (span unchanged).
    const tail = applyCommand(project, {
      type: 'trimElement',
      elementId: 'e-v',
      trimStartMs: 7000,
      durationMs: 3000,
    })
    const sped = applyCommand(tail, { type: 'setElementSpeed', elementId: 'e-v', speed: 2 })
    const v = getElement(sped, 'e-v' as `e-${string}`) as VideoElement
    expect(v.durationMs).toBe(1500)
    expect(v.trimStartMs + getSourceSpanMs(v)).toBe(10_000)
  })

  test('rejects elements without playback speed', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-t', text: 'x', startMs: 0, durationMs: 1000 },
    })
    expect(() => applyCommand(project, { type: 'setElementSpeed', elementId: 'e-t', speed: 2 })).toThrow(
      CommandError,
    )
  })
})

describe('setTimeMap command', () => {
  test('sets ramps and clears with null', () => {
    const { project } = projectWithVideo()
    const ramp = [
      { timeMs: 0, value: 0, easing: 'easeInOut' as const },
      { timeMs: 4000, value: 8000 },
    ]
    const next = applyCommand(project, { type: 'setTimeMap', elementId: 'e-v', timeMap: ramp })
    expect((getElement(next, 'e-v' as `e-${string}`) as VideoElement).timeMap).toEqual(ramp)
    const cleared = applyCommand(next, { type: 'setTimeMap', elementId: 'e-v', timeMap: null })
    expect((getElement(cleared, 'e-v' as `e-${string}`) as VideoElement).timeMap).toBeUndefined()
  })

  test('rejects maps that overrun the asset', () => {
    const { project } = projectWithVideo()
    expect(() =>
      applyCommand(project, {
        type: 'setTimeMap',
        elementId: 'e-v',
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 4000, value: 11_000 },
        ],
      }),
    ).toThrow(CommandError)
  })
})

describe('splitting time-mapped clips', () => {
  test('split keeps trimStartMs and divides the curve continuously', () => {
    const { project } = projectWithVideo()
    let next = applyCommand(project, { type: 'setElementSpeed', elementId: 'e-v', speed: 2 })
    next = applyCommand(next, {
      type: 'splitElement',
      elementId: 'e-v',
      atMs: 500,
      rightElementId: 'e-r',
    })
    const left = getElement(next, 'e-v' as `e-${string}`) as VideoElement
    const right = getElement(next, 'e-r' as `e-${string}`) as VideoElement

    expect(left.durationMs).toBe(500)
    expect(right.durationMs).toBe(1500)
    expect(right.trimStartMs).toBe(left.trimStartMs) // map carries the offset
    // Continuity: the source time at the cut matches on both sides.
    expect(getSourceTimeMs(left, 500)).toBe(getSourceTimeMs(right, 0))
    expect(getSourceTimeMs(right, 0)).toBe(1000)
    // Both halves still play at 2x.
    expect(getSpeedAt(left, 250)).toBeCloseTo(2, 3)
    expect(getSpeedAt(right, 750)).toBeCloseTo(2, 3)
  })

  test('splitTimeMap halves a ramp continuously', () => {
    const map = [
      { timeMs: 0, value: 0 },
      { timeMs: 1000, value: 4000 },
    ]
    const { left, right } = splitTimeMap(map, 250)
    expect(left[left.length - 1]).toMatchObject({ timeMs: 250, value: 1000 })
    expect(right[0]).toMatchObject({ timeMs: 0, value: 1000 })
    expect(right[right.length - 1]).toMatchObject({ timeMs: 750, value: 4000 })
  })
})
