import { describe, expect, test } from 'bun:test'
import type { AudibleSegment } from './export-audio-composite'
import { contextAt, heardContextS, planWindow, timelineAt } from './preview-audio-plan'

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

describe('planWindow', () => {
  const clip: AudibleSegment = { elementId: 'e-1', src: 'blob:a', startMs: 1000, durationMs: 4000, trimStartMs: 2000, sourceSpanMs: 4000, volume: 0.5 }
  const anchor = { timelineMs: 1500, contextS: 10, rate: 1 }

  test('a plain window starts at its heard time and overhangs by the crossfade', () => {
    expect(planWindow(clip, anchor, 10, 10.5, false)).toEqual({
      segment: { elementId: 'e-1', src: 'blob:a', startMs: 10000, durationMs: 510, trimStartMs: 2500, sourceSpanMs: 510, volume: 1 },
      gate: { openS: 10, fadeInS: 0, closeS: 10.5, fadeOutS: 0.01 },
      endS: 10.51,
    })
  })

  test('the window that reaches the clip end fades in and never closes', () => {
    expect(planWindow(clip, anchor, 13, 13.5, true)).toEqual({
      segment: { elementId: 'e-1', src: 'blob:a', startMs: 13000, durationMs: 500, trimStartMs: 5500, sourceSpanMs: 500, volume: 1 },
      gate: { openS: 13, fadeInS: 0.01, closeS: null, fadeOutS: 0 },
      endS: 13.5,
    })
  })

  test('a window outside the clip plans nothing', () => {
    expect(planWindow(clip, anchor, 15, 15.5, true)).toBeNull()
    expect(planWindow(clip, { ...anchor, timelineMs: 0 }, 10, 10.5, false)).toBeNull()
  })

  test('a transport rate stretches the window with a pre-roll the gate hides', () => {
    expect(planWindow(clip, { ...anchor, rate: 2 }, 10, 10.5, false)).toEqual({
      segment: {
        elementId: 'e-1',
        src: 'blob:a',
        startMs: 9750,
        durationMs: 760,
        trimStartMs: 2000,
        sourceSpanMs: 1520,
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 760, value: 1520 },
        ],
        volume: 1,
      },
      gate: { openS: 10, fadeInS: 0, closeS: 10.5, fadeOutS: 0.01 },
      endS: 10.51,
    })
  })

  test('a reversed clip reads its source range from the end', () => {
    expect(planWindow({ ...clip, reversed: true }, anchor, 10, 10.5, false)?.segment).toEqual({
      elementId: 'e-1',
      src: 'blob:a',
      startMs: 10000,
      durationMs: 510,
      trimStartMs: 4990,
      sourceSpanMs: 510,
      reversed: true,
      volume: 1,
    })
  })

  test('a constant clip speed reads source at that speed', () => {
    const fast: AudibleSegment = {
      ...clip,
      sourceSpanMs: 8000,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 4000, value: 8000 },
      ],
    }
    expect(planWindow(fast, anchor, 10, 10.5, false)?.segment).toEqual({
      elementId: 'e-1',
      src: 'blob:a',
      startMs: 9750,
      durationMs: 760,
      trimStartMs: 2500,
      sourceSpanMs: 1520,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 760, value: 1520 },
      ],
      volume: 1,
    })
  })

  test('a speed ramp is resampled into the window every 10 ms', () => {
    const ramp: AudibleSegment = {
      ...clip,
      sourceSpanMs: 6000,
      timeMap: [
        { timeMs: 0, value: 0 },
        { timeMs: 2000, value: 2000 },
        { timeMs: 4000, value: 6000 },
      ],
    }
    expect(planWindow(ramp, anchor, 10, 10.03125, false)?.segment).toEqual({
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
    })
  })

  test('consecutive windows tile the heard clip with continuous source time', () => {
    const played = { ...anchor, timelineMs: 1000, rate: 1.5 }
    const endS = contextAt(played, clip.startMs + clip.durationMs)
    let openS = contextAt(played, clip.startMs)
    let index = 0
    for (let fromS = openS; fromS < endS - 1e-9; fromS += 0.5, index++) {
      const planned = planWindow(clip, played, fromS, Math.min(fromS + 0.5, endS), index > 0)
      if (!planned) throw new Error(`window ${index} planned nothing`)
      expect(planned.gate.openS).toBeCloseTo(openS, 9)
      const sourceAtOpen = planned.segment.trimStartMs + (planned.gate.openS * 1000 - planned.segment.startMs) * played.rate
      expect(sourceAtOpen).toBeCloseTo(clip.trimStartMs + timelineAt(played, planned.gate.openS) - clip.startMs, 6)
      openS = planned.gate.closeS ?? endS
    }
    expect(openS).toBe(endS)
    expect(index).toBe(6)
  })
})
