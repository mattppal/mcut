import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { applyEdgeTrim, getEdgeTrimRange } from './edge-trim'
import { createProject, type Project, type TimelineElement, type VideoElement } from './model'
import { getElement, getTrack } from './selectors'
import { getSourceTimeMs, makeConstantSpeedMap } from './speed'

const TRACK = 't-default'

function baseProject(): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-src', kind: 'video', src: 'blob:src', durationMs: 10_000 },
  })
  return project
}

function withVideo(project: Project, overrides: Partial<VideoElement> = {}): Project {
  return applyCommand(project, {
    type: 'addElement',
    trackId: TRACK,
    element: {
      id: 'e-v',
      type: 'video',
      assetId: 'a-src',
      startMs: 2000,
      durationMs: 3000,
      trimStartMs: 1000,
      ...overrides,
    },
  })
}

const video = (project: Project): VideoElement => getElement(project, 'e-v') as VideoElement

describe('applyEdgeTrim on plain video', () => {
  const element = () => video(withVideo(baseProject()))

  test('end grow extends duration, consuming tail media', () => {
    const next = applyEdgeTrim(element(), 'end', 500)
    expect(next).toMatchObject({ startMs: 2000, durationMs: 3500, trimStartMs: 1000 })
  })

  test('end shrink cuts the tail', () => {
    const next = applyEdgeTrim(element(), 'end', -500)
    expect(next).toMatchObject({ startMs: 2000, durationMs: 2500, trimStartMs: 1000 })
  })

  test('start shrink conceals head media', () => {
    const next = applyEdgeTrim(element(), 'start', 500)
    expect(next).toMatchObject({ startMs: 2500, durationMs: 2500, trimStartMs: 1500 })
  })

  test('start grow reveals head media', () => {
    const next = applyEdgeTrim(element(), 'start', -500)
    expect(next).toMatchObject({ startMs: 1500, durationMs: 3500, trimStartMs: 500 })
  })

  test('start grow past the media head throws', () => {
    expect(() => applyEdgeTrim(element(), 'start', -1500)).toThrow(CommandError)
  })

  test('shrinking below the minimum duration throws', () => {
    expect(() => applyEdgeTrim(element(), 'end', -2995)).toThrow(CommandError)
  })

  test('start grow shifts keyframes so motion stays anchored', () => {
    const keyframed: TimelineElement = {
      ...element(),
      keyframes: { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] },
    }
    const next = applyEdgeTrim(keyframed, 'start', -500)
    expect(next.keyframes?.opacity).toEqual([
      { timeMs: 500, value: 0 },
      { timeMs: 1500, value: 1 },
    ])
  })

  test('start shrink rebases keyframes through the split machinery', () => {
    const keyframed: TimelineElement = {
      ...element(),
      keyframes: { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] },
    }
    const next = applyEdgeTrim(keyframed, 'start', 500)
    expect(next.keyframes?.opacity).toEqual([
      { timeMs: 0, value: 0.5 },
      { timeMs: 500, value: 1 },
    ])
  })
})

describe('applyEdgeTrim on reversed clips', () => {
  const reversed = () => ({ ...video(withVideo(baseProject())), reversed: true }) as VideoElement

  test('end grow reveals EARLIER source (window slides down)', () => {
    const next = applyEdgeTrim(reversed(), 'end', 500) as VideoElement
    expect(next).toMatchObject({ durationMs: 3500, trimStartMs: 500 })
    // Content anchor: source at output 0 is unchanged.
    expect(getSourceTimeMs(next, 0)).toBe(getSourceTimeMs(reversed(), 0))
  })

  test('start grow reveals LATER source, trim unchanged', () => {
    const next = applyEdgeTrim(reversed(), 'start', -500) as VideoElement
    expect(next).toMatchObject({ startMs: 1500, durationMs: 3500, trimStartMs: 1000 })
    // Content anchor: what played at output local L plays at L+500 now.
    expect(getSourceTimeMs(next, 1000)).toBe(getSourceTimeMs(reversed(), 500))
  })

  test('end grow past the media head throws', () => {
    expect(() => applyEdgeTrim(reversed(), 'end', 1500)).toThrow(CommandError)
  })
})

describe('applyEdgeTrim on speed-ramped clips', () => {
  const ramped = (): VideoElement => ({
    ...video(withVideo(baseProject())),
    timeMap: makeConstantSpeedMap(3000, 2), // consumes 6000ms source
  })

  test('end grow freezes (map clamps); no trim bookkeeping', () => {
    const next = applyEdgeTrim(ramped(), 'end', 500) as VideoElement
    expect(next.durationMs).toBe(3500)
    expect(next.trimStartMs).toBe(1000)
    expect(getSourceTimeMs(next, 3400)).toBe(getSourceTimeMs(ramped(), 3000))
  })

  test('end shrink splits the map', () => {
    const next = applyEdgeTrim(ramped(), 'end', -1000) as VideoElement
    expect(next.durationMs).toBe(2000)
    expect(next.timeMap?.at(-1)).toMatchObject({ timeMs: 2000, value: 4000 })
  })

  test('start shrink keeps trim; the map carries the offset', () => {
    const next = applyEdgeTrim(ramped(), 'start', 1000) as VideoElement
    expect(next).toMatchObject({ startMs: 3000, durationMs: 2000, trimStartMs: 1000 })
    // Source mapping is unchanged for surviving content.
    expect(getSourceTimeMs(next, 0)).toBe(getSourceTimeMs(ramped(), 1000))
    expect(getSourceTimeMs(next, 2000)).toBe(getSourceTimeMs(ramped(), 3000))
  })

  test('start grow rebases trim and covers the head at 1x', () => {
    const next = applyEdgeTrim(ramped(), 'start', -500) as VideoElement
    expect(next).toMatchObject({ startMs: 1500, durationMs: 3500, trimStartMs: 500 })
    // New head plays the revealed media at 1x...
    expect(getSourceTimeMs(next, 0)).toBe(500)
    expect(getSourceTimeMs(next, 250)).toBe(750)
    // ...and surviving content keeps its absolute source times.
    expect(getSourceTimeMs(next, 500)).toBe(getSourceTimeMs(ramped(), 0))
    expect(getSourceTimeMs(next, 2500)).toBe(getSourceTimeMs(ramped(), 2000))
  })

  test('start grow on reversed ramped clips is unsupported', () => {
    const element = { ...ramped(), reversed: true }
    expect(() => applyEdgeTrim(element, 'start', -500)).toThrow(CommandError)
  })
})

describe('getEdgeTrimRange', () => {
  test('plain video: bounded by media handles and minimum duration', () => {
    const project = withVideo(baseProject())
    const element = video(project)
    // Head: 1000ms of trim available; tail: 10000 - 1000 - 3000 = 6000.
    expect(getEdgeTrimRange(project, element, 'start')).toEqual({
      minDeltaMs: -1000,
      maxDeltaMs: 2990,
    })
    expect(getEdgeTrimRange(project, element, 'end')).toEqual({
      minDeltaMs: -2990,
      maxDeltaMs: 6000,
    })
  })

  test('start grow is also clamped by timeline zero', () => {
    const project = withVideo(baseProject(), { startMs: 300, trimStartMs: 1000 })
    expect(getEdgeTrimRange(project, video(project), 'start').minDeltaMs).toBe(-300)
  })

  test('freeze tails make end growth unbounded', () => {
    const project = withVideo(baseProject())
    const element = { ...video(project), timeMap: makeConstantSpeedMap(3000, 2) }
    expect(getEdgeTrimRange(project, element, 'end').maxDeltaMs).toBe(Infinity)
  })

  test('text is bounded only by duration and timeline zero', () => {
    let project = baseProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: { id: 'e-t', type: 'text', text: 'hi', startMs: 500, durationMs: 2000 },
    })
    const element = getElement(project, 'e-t')!
    expect(getEdgeTrimRange(project, element, 'start')).toEqual({
      minDeltaMs: -500,
      maxDeltaMs: 1990,
    })
    expect(getEdgeTrimRange(project, element, 'end')).toEqual({
      minDeltaMs: -1990,
      maxDeltaMs: Infinity,
    })
  })
})

// ---------------------------------------------------------------------------
// Commands built on the edge-trim core
// ---------------------------------------------------------------------------

function threeAdjacentClips(): Project {
  let project = baseProject()
  for (const [id, startMs, trimStartMs] of [
    ['e-1', 0, 1000],
    ['e-2', 2000, 4000],
    ['e-3', 4000, 7000],
  ] as const) {
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: { id, type: 'video', assetId: 'a-src', startMs, durationMs: 2000, trimStartMs },
    })
  }
  return project
}

describe('slipElement', () => {
  test('shifts the source window without moving the clip', () => {
    const project = applyCommand(withVideo(baseProject()), {
      type: 'slipElement',
      elementId: 'e-v',
      deltaMs: 500,
    })
    expect(video(project)).toMatchObject({ startMs: 2000, durationMs: 3000, trimStartMs: 1500 })
  })

  test('clamps to media bounds', () => {
    const project = withVideo(baseProject())
    expect(() =>
      applyCommand(project, { type: 'slipElement', elementId: 'e-v', deltaMs: -1500 }),
    ).toThrow(CommandError)
    // 10000 - 3000 = 7000 max trim; current 1000 → +6000 ok, +6001 overruns.
    expect(() =>
      applyCommand(project, { type: 'slipElement', elementId: 'e-v', deltaMs: 6001 }),
    ).toThrow(CommandError)
    applyCommand(project, { type: 'slipElement', elementId: 'e-v', deltaMs: 6000 })
  })

  test('slips every multicam source in sync', () => {
    let project = baseProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: {
        id: 'e-m',
        type: 'multicam',
        startMs: 0,
        durationMs: 2000,
        sources: [
          { key: 'screen', assetId: 'a-src', trimStartMs: 100 },
          { key: 'camera', assetId: 'a-src', trimStartMs: 600 },
        ],
        angles: [{ atMs: 0, layoutId: 'l-x' }],
      },
    })
    project = applyCommand(project, { type: 'slipElement', elementId: 'e-m', deltaMs: 300 })
    const element = getElement(project, 'e-m')!
    expect(element.type === 'multicam' && element.sources.map((s) => s.trimStartMs)).toEqual([
      400, 900,
    ])
  })

  test('rejects non-source elements', () => {
    let project = baseProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: TRACK,
      element: { id: 'e-t', type: 'text', text: 'x', startMs: 0, durationMs: 1000 },
    })
    expect(() =>
      applyCommand(project, { type: 'slipElement', elementId: 'e-t', deltaMs: 100 }),
    ).toThrow(CommandError)
  })
})

describe('rollEdit', () => {
  test('moves the cut, adjusting both clips, leaving the rest untouched', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'rollEdit',
      elementId: 'e-1',
      deltaMs: 500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 2500 })
    expect(getElement(project, 'e-2')).toMatchObject({
      startMs: 2500,
      durationMs: 1500,
      trimStartMs: 4500,
    })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 4000, durationMs: 2000 })
  })

  test('rolls left too', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'rollEdit',
      elementId: 'e-1',
      deltaMs: -500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 1500 })
    expect(getElement(project, 'e-2')).toMatchObject({
      startMs: 1500,
      durationMs: 2500,
      trimStartMs: 3500,
    })
  })

  test('requires a butt cut', () => {
    const project = withVideo(baseProject())
    expect(() =>
      applyCommand(project, { type: 'rollEdit', elementId: 'e-v', deltaMs: 100 }),
    ).toThrow(CommandError)
  })

  test('keeps the transition on the rolled cut valid', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-1',
      transition: { type: 'dissolve', durationMs: 500 },
    })
    project = applyCommand(project, { type: 'rollEdit', elementId: 'e-1', deltaMs: 300 })
    const left = getElement(project, 'e-1')!
    const right = getElement(project, 'e-2')!
    expect('transition' in left && left.transition?.type).toBe('dissolve')
    expect(left.startMs + left.durationMs).toBe(right.startMs)
  })
})

describe('slideElement', () => {
  test('moves the middle clip; neighbors absorb the delta', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'slideElement',
      elementId: 'e-2',
      deltaMs: 500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 2500 })
    expect(getElement(project, 'e-2')).toMatchObject({
      startMs: 2500,
      durationMs: 2000,
      trimStartMs: 4000, // content untouched
    })
    expect(getElement(project, 'e-3')).toMatchObject({
      startMs: 4500,
      durationMs: 1500,
      trimStartMs: 7500,
    })
  })

  test('requires neighbors on both sides', () => {
    const project = withVideo(baseProject())
    expect(() =>
      applyCommand(project, { type: 'slideElement', elementId: 'e-v', deltaMs: 100 }),
    ).toThrow(CommandError)
  })

  test('clamps to neighbor minimum durations', () => {
    expect(() =>
      applyCommand(threeAdjacentClips(), { type: 'slideElement', elementId: 'e-2', deltaMs: 1995 }),
    ).toThrow(CommandError)
  })
})

describe('rippleTrim', () => {
  test('end trim shifts downstream clips on the same track', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({ durationMs: 1500 })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 1500 })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 3500 })
  })

  test('start trim keeps the clip position and pulls downstream left', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'rippleTrim',
      elementId: 'e-2',
      edge: 'start',
      deltaMs: 500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({ startMs: 0, durationMs: 2000 })
    expect(getElement(project, 'e-2')).toMatchObject({
      startMs: 2000,
      durationMs: 1500,
      trimStartMs: 4500,
    })
    expect(getElement(project, 'e-3')).toMatchObject({ startMs: 3500 })
  })

  test('start grow at timeline zero pushes downstream right', () => {
    const project = applyCommand(threeAdjacentClips(), {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'start',
      deltaMs: -500,
    })
    expect(getElement(project, 'e-1')).toMatchObject({
      startMs: 0,
      durationMs: 2500,
      trimStartMs: 500,
    })
    expect(getElement(project, 'e-2')).toMatchObject({ startMs: 2500 })
  })

  test('timeline scope shifts other unlocked tracks; track scope does not', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, { type: 'addTrack', id: 't-b' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-b',
      element: { id: 'e-other', type: 'text', text: 'x', startMs: 3000, durationMs: 1000 },
    })
    const timelineScoped = applyCommand(project, {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
    })
    expect(getElement(timelineScoped, 'e-other')).toMatchObject({ startMs: 2500 })
    const trackScoped = applyCommand(project, {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
      scope: 'track',
    })
    expect(getElement(trackScoped, 'e-other')).toMatchObject({ startMs: 3000 })
  })

  test('locked tracks never shift', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, { type: 'addTrack', id: 't-b' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-b',
      element: { id: 'e-other', type: 'text', text: 'x', startMs: 3000, durationMs: 1000 },
    })
    project = applyCommand(project, { type: 'setTrackFlags', trackId: 't-b', locked: true })
    const next = applyCommand(project, {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
    })
    expect(getElement(next, 'e-other')).toMatchObject({ startMs: 3000 })
  })

  test('a ripple that would collide with a straddling clip throws', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, { type: 'addTrack', id: 't-b' })
    // Straddles the cut at 2000 on another track and a clip right after it.
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-b',
      element: { id: 'e-straddle', type: 'text', text: 'x', startMs: 1000, durationMs: 2500 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-b',
      element: { id: 'e-after', type: 'text', text: 'y', startMs: 3600, durationMs: 500 },
    })
    expect(() =>
      applyCommand(project, { type: 'rippleTrim', elementId: 'e-1', edge: 'end', deltaMs: -500 }),
    ).toThrow(CommandError)
  })

  test('downstream transitions stay valid because pairs shift together', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-2',
      transition: { type: 'dissolve', durationMs: 300 },
    })
    project = applyCommand(project, {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
    })
    const left = getElement(project, 'e-2')!
    const right = getElement(project, 'e-3')!
    expect(left.startMs + left.durationMs).toBe(right.startMs)
  })
})

describe('magnetic tracks', () => {
  test('rippleTrim on a magnetic track stays packed', () => {
    let project = threeAdjacentClips()
    project = applyCommand(project, { type: 'setTrackFlags', trackId: TRACK, magnetic: true })
    project = applyCommand(project, {
      type: 'rippleTrim',
      elementId: 'e-1',
      edge: 'end',
      deltaMs: -500,
    })
    expect(getTrack(project, TRACK)!.elements.map((e) => e.startMs)).toEqual([0, 1500, 3500])
  })
})
