import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError, type BuiltinCommand } from './commands'
import type { Keyframe } from './keyframes'
import { createProject, type Project } from './model'
import { thrownBy } from './test-helpers'

function project(): Project {
  const steps: BuiltinCommand[] = [
    { type: 'addTrack', id: 't-title' },
    { type: 'addTrack', id: 't-locked' },
    { type: 'addAsset', asset: { id: 'a-v', kind: 'video', src: 'v.mp4', durationMs: 60000, width: 1280, height: 720 } },
    { type: 'addElement', trackId: 't-default', element: { id: 'e-v', type: 'video', assetId: 'a-v', startMs: 0, durationMs: 10000, trimStartMs: 0 } },
    { type: 'addElement', trackId: 't-title', element: { id: 'e-title', type: 'text', text: 'Hi', startMs: 1000, durationMs: 8000 } },
    { type: 'addElement', trackId: 't-locked', element: { id: 'e-logo', type: 'text', text: 'Logo', startMs: 6000, durationMs: 1000 } },
    { type: 'setTrackFlags', trackId: 't-locked', locked: true },
    { type: 'addMarker', id: 'm-in', timeMs: 2500 },
    { type: 'addMarker', id: 'm-after', timeMs: 8000 },
  ]
  return steps.reduce(applyCommand, createProject({ id: 'p-ranges' }))
}

const elementsOn = (p: Project, trackId: string) =>
  (p.tracks.find((track) => track.id === trackId)?.elements ?? []).map((e) => [e.startMs, e.durationMs, 'trimStartMs' in e ? e.trimStartMs : null])

describe('removeRanges', () => {
  test('merges overlapping ranges in any order, splits clips, shrinks text, shifts markers, and leaves locked tracks alone', () => {
    const next = applyCommand(project(), {
      type: 'removeRanges',
      ranges: [
        { startMs: 6000, endMs: 7000 },
        { startMs: 2500, endMs: 4000 },
        { startMs: 2000, endMs: 3000 },
      ],
    })
    expect(elementsOn(next, 't-default')).toEqual([
      [0, 2000, 0],
      [2000, 2000, 4000],
      [4000, 3000, 7000],
    ])
    expect(elementsOn(next, 't-title')).toEqual([[1000, 5000, null]])
    expect(elementsOn(next, 't-locked')).toEqual([[6000, 1000, null]])
    expect(next.markers.map((m) => [m.id, m.timeMs])).toEqual([['m-after', 5000]])
  })

  test('a title spanning a range keeps its fade-out, shifted left with the content, and drops keyframes inside the range', () => {
    const fading: Keyframe[] = [
      { timeMs: 0, value: 0 },
      { timeMs: 500, value: 1 },
      { timeMs: 2500, value: 0.5 },
      { timeMs: 5500, value: 1 },
      { timeMs: 6000, value: 0 },
    ]
    const withTitle = applyCommand(project(), {
      type: 'updateElement',
      elementId: 'e-title',
      patch: { startMs: 3000, durationMs: 6000, keyframes: { opacity: fading } },
    })
    const next = applyCommand(withTitle, { type: 'removeRanges', ranges: [{ startMs: 5000, endMs: 6000 }] })
    const title = next.tracks.find((track) => track.id === 't-title')?.elements[0]
    expect(title?.durationMs).toBe(5000)
    const opacity = title?.keyframes?.opacity ?? []
    expect(opacity.map((k) => k.timeMs)).toEqual([0, 500, 2000, 4500, 5000])
    expect(opacity.map((k) => k.value).slice(0, 2)).toEqual([0, 1])
    expect(opacity.map((k) => k.value).slice(3)).toEqual([1, 0])
    expect(opacity[2]?.value).toBeCloseTo(0.5 + 0.5 / 6)
  })

  test('a range starting at or after the timeline end is rejected', () => {
    const error = thrownBy(() => applyCommand(project(), { type: 'removeRanges', ranges: [{ startMs: 10000, endMs: 11000 }] }))
    expect(error).toBeInstanceOf(CommandError)
  })
})
