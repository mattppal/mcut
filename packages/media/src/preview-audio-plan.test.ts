import { describe, expect, test } from 'bun:test'
import { contextAt, heardContextS, timelineAt } from './preview-audio-plan'

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
