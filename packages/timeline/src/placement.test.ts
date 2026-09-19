import { describe, expect, test } from 'bun:test'
import type { TrackId } from './id'
import { createProject, elementSchema, trackSchema, type Project, type TimelineElement, type Track } from './model'
import { canPlace, compactTimelineIfMagnetic, placementFor } from './placement'

const text = (id: string, startMs: number, durationMs: number): TimelineElement => elementSchema.parse({ id, type: 'text', text: id, startMs, durationMs })

const track = (id: TrackId, magnetic: boolean, elements: TimelineElement[]): Track => trackSchema.parse({ id, name: id, magnetic, elements })

const order = (elements: TimelineElement[]) => elements.map((e) => [e.id, e.startMs])

describe('gapped placement', () => {
  const gapped = track('t-1', false, [text('e-a', 0, 1000), text('e-b', 2000, 1000)])
  const policy = placementFor(gapped)

  test('rejects an overlapping placement and accepts an adjacent one', () => {
    expect(canPlace(gapped, 500, 1000)).toBe(false)
    expect(canPlace(gapped, 1000, 1000)).toBe(true)
    expect(canPlace(gapped, -1, 1000)).toBe(false)
    expect(canPlace(gapped, 500, 1000, 'e-a')).toBe(true)
    expect(() => policy.assertCanPlace(gapped, text('e-c', 500, 1000))).toThrow('would overlap "e-a"')
  })

  test('places at the literal time, removes without closing the gap, and honors the edit mode', () => {
    expect(order(policy.place(gapped, text('e-c', 1000, 1000)))).toEqual([
      ['e-a', 0],
      ['e-c', 1000],
      ['e-b', 2000],
    ])
    expect(order(policy.remove(gapped, 'e-a'))).toEqual([['e-b', 2000]])
    expect(policy.editMode('overwrite')).toBe('overwrite')
  })

  test('assertNoOverlaps names the colliding pair', () => {
    const colliding = track('t-1', false, [text('e-a', 0, 1000), text('e-b', 500, 1000)])
    expect(() => policy.assertNoOverlaps(colliding)).toThrow('overlap "e-a" and "e-b"')
    expect(() => policy.assertNoOverlaps(gapped)).not.toThrow()
  })
})

describe('magnetic placement', () => {
  const packed = track('t-1', true, [text('e-a', 0, 1000), text('e-b', 1000, 400), text('e-c', 1400, 600)])
  const policy = placementFor(packed)

  test('compacts the gap after removal to exact ms values', () => {
    expect(order(policy.remove(packed, 'e-b'))).toEqual([
      ['e-a', 0],
      ['e-c', 1000],
    ])
  })

  test('drops a clip into the slot chosen by its left edge and packs the track', () => {
    expect(order(policy.place(packed, text('e-d', 1100, 200)))).toEqual([
      ['e-a', 0],
      ['e-d', 1000],
      ['e-b', 1200],
      ['e-c', 1600],
    ])
  })

  test('accepts overlaps and collapses every edit mode to normal', () => {
    const colliding = track('t-1', true, [text('e-a', 0, 1000), text('e-b', 500, 1000)])
    expect(() => policy.assertCanPlace(packed, text('e-d', 200, 5000))).not.toThrow()
    expect(() => policy.assertNoOverlaps(colliding)).not.toThrow()
    expect(policy.editMode('overwrite')).toBe('normal')
    expect(policy.editMode('insert')).toBe('normal')
  })
})

describe('compactTimelineIfMagnetic', () => {
  test('packs every track once any track is magnetic and leaves a gapped timeline untouched', () => {
    const mixed: Project = {
      ...createProject(),
      tracks: [track('t-1', true, [text('e-a', 0, 1000), text('e-b', 3000, 1000)]), track('t-2', false, [text('e-x', 5000, 1000)])],
    }
    expect(compactTimelineIfMagnetic(mixed).tracks.map((t) => order(t.elements))).toEqual([
      [
        ['e-a', 0],
        ['e-b', 1000],
      ],
      [['e-x', 0]],
    ])
    const gapped: Project = {
      ...createProject(),
      tracks: [track('t-1', false, [text('e-a', 0, 1000), text('e-b', 3000, 1000)])],
    }
    expect(compactTimelineIfMagnetic(gapped)).toBe(gapped)
  })
})
