import { describe, expect, test } from 'bun:test'
import type { AudibleSegment } from './export-audio-composite'
import { contextAt, epochChange, heardContextS, planFeed, planWindow, sourceMapOf, timelineAt } from './preview-audio-plan'

describe('audio clock anchor', () => {
  const anchor = { timelineMs: 1000, contextS: 2, rate: 1 }

  test('holds the anchor time until the scheduled start is heard', () => {
    expect(timelineAt(anchor, 1.5)).toBe(1000)
    expect(timelineAt(anchor, 2)).toBe(1000)
  })

  test('advances the timeline with heard context time times the transport rate', () => {
    expect(timelineAt(anchor, 2.25)).toBe(1250)
    expect(timelineAt({ ...anchor, rate: 2 }, 2.25)).toBe(1500)
  })

  test('maps a timeline time to the context time it is heard at', () => {
    expect(contextAt(anchor, 1250)).toBe(2.25)
    expect(contextAt({ ...anchor, rate: 2 }, 1500)).toBe(2.25)
  })

  test('extrapolates the output timestamp to the frame time', () => {
    expect(heardContextS({ contextTime: 10, performanceTime: 5000 }, 5016)).toBeCloseTo(10.016, 9)
  })
})

describe('epochChange', () => {
  const playing = { rate: 1, reportedMs: 5000, sounding: true }

  test('the same rate at the reported position keeps the epoch', () => {
    expect(epochChange(playing, { currentTimeMs: 5000.5, playbackRate: 1 })).toBe('keep')
  })

  test('a seek restarts the epoch', () => {
    expect(epochChange(playing, { currentTimeMs: 7000, playbackRate: 1 })).toBe('restart')
    expect(epochChange(null, { currentTimeMs: 0, playbackRate: 1 })).toBe('restart')
  })

  test('a rate change while sounding hands the timeline to a new epoch instead of cutting the sound', () => {
    expect(epochChange(playing, { currentTimeMs: 5000, playbackRate: 2 })).toBe('handoff')
  })

  test('a rate change before anything sounds restarts', () => {
    expect(epochChange({ ...playing, sounding: false }, { currentTimeMs: 5000, playbackRate: 2 })).toBe('restart')
  })
})

describe('planFeed', () => {
  const clip: AudibleSegment = { elementId: 'e-1', src: 'blob:a', startMs: 1000, durationMs: 4000, trimStartMs: 2000, sourceSpanMs: 4000, volume: 0.5 }
  const anchor = { timelineMs: 1500, contextS: 10, rate: 1 }
  const plain = { kind: 'linear', offsetMs: 0, speed: 1 } as const

  test('a clip at rate 1 reads its source from the heard time to its end without a pre-roll', () => {
    expect(planFeed(clip, plain, anchor, 10)).toEqual({
      plan: { reversed: false, sourceS: 2.5, spanS: 3.5, prerollS: 0, tempo: 1 },
      startS: 10,
      endS: 13.5,
    })
  })

  test('a transport rate stretches at that tempo behind a pre-roll the voice does not play', () => {
    expect(planFeed(clip, plain, { ...anchor, rate: 2 }, 10)).toEqual({
      plan: { reversed: false, sourceS: 2.5, spanS: 3.5, prerollS: 0.5, tempo: 2 },
      startS: 10,
      endS: 11.75,
    })
  })

  test('a clip heard from its start has nothing before it to pre-roll', () => {
    expect(planFeed(clip, plain, { ...anchor, timelineMs: 1000, rate: 2 }, 10)?.plan.prerollS).toBe(0)
  })

  test('a reversed clip reads down from the end of its source range', () => {
    expect(planFeed({ ...clip, reversed: true }, plain, anchor, 10)?.plan).toEqual({
      reversed: true,
      sourceS: 5.5,
      spanS: 3.5,
      prerollS: 0,
      tempo: 1,
    })
  })

  test('a constant clip speed multiplies the tempo and the source it reads', () => {
    const fast: AudibleSegment = {
      ...clip,
      sourceSpanMs: 8000,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 4000, value: 8000 },
      ],
    }
    expect(planFeed(fast, { kind: 'linear', offsetMs: 0, speed: 2 }, anchor, 10)?.plan).toEqual({
      reversed: false,
      sourceS: 3,
      spanS: 7,
      prerollS: 0.5,
      tempo: 2,
    })
  })

  test('a clip already over plans nothing', () => {
    expect(planFeed(clip, plain, anchor, 13.5)).toBeNull()
  })

  test('a reversed clip and a constant speed read linearly, and a speed ramp does not', () => {
    expect(sourceMapOf({ ...clip, reversed: true, sourceSpanMs: 6000 })).toEqual({ kind: 'linear', offsetMs: 0, speed: 1.5 })
    const split = [
      { timeMs: 0, value: 1000 },
      { timeMs: 1500, value: 4000 },
    ]
    expect(sourceMapOf({ ...clip, timeMap: split })).toEqual({ kind: 'linear', offsetMs: 1000, speed: 2 })
    const ramp = [
      { timeMs: 0, value: 0 },
      { timeMs: 2000, value: 2000 },
      { timeMs: 4000, value: 6000 },
    ]
    expect(sourceMapOf({ ...clip, timeMap: ramp })).toEqual({ kind: 'curve', timeMap: ramp })
  })
})

describe('planWindow', () => {
  const ramp: AudibleSegment = {
    elementId: 'e-1',
    src: 'blob:a',
    startMs: 1000,
    durationMs: 4000,
    trimStartMs: 2000,
    sourceSpanMs: 6000,
    timeMap: [
      { timeMs: 0, value: 0 },
      { timeMs: 2000, value: 2000 },
      { timeMs: 4000, value: 6000 },
    ],
    volume: 0.5,
  }
  const curve = ramp.timeMap ?? []
  const anchor = { timelineMs: 1500, contextS: 10, rate: 1 }

  test('a speed ramp is resampled into the window every 10 ms and overhangs by the crossfade', () => {
    expect(planWindow(ramp, curve, anchor, 10, 10.03125, false)).toEqual({
      segment: {
        elementId: 'e-1',
        src: 'blob:a',
        startMs: 10000,
        durationMs: 41.25,
        trimStartMs: 2500,
        sourceSpanMs: 41.25,
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 10, value: 10 },
          { timeMs: 20, value: 20 },
          { timeMs: 30, value: 30 },
          { timeMs: 40, value: 40 },
          { timeMs: 41.25, value: 41.25 },
        ],
        volume: 1,
      },
      gate: { openS: 10, fadeInS: 0, closeS: 10.03125, fadeOutS: 0.01 },
      endS: 10.04125,
    })
  })

  test('the window that reaches the clip end fades in and never closes', () => {
    expect(planWindow(ramp, curve, anchor, 13, 13.5, true)?.gate).toEqual({ openS: 13, fadeInS: 0.01, closeS: null, fadeOutS: 0 })
  })

  test('a window outside the clip plans nothing', () => {
    expect(planWindow(ramp, curve, anchor, 13.5, 14, true)).toBeNull()
    expect(planWindow(ramp, curve, { ...anchor, timelineMs: 0 }, 10, 10.5, false)).toBeNull()
  })
})
