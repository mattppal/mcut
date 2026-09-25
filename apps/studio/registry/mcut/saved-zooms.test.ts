import { describe, expect, test } from 'bun:test'
import { toSavedZoom } from './saved-zooms'

const saved = (durationMs: number, scaleX: Array<{ t: number; value: number; easing?: 'easeInOut' }>) => ({
  id: 'tpl-1',
  kind: 'zoom' as const,
  name: 'Mine',
  payload: { durationMs, tracks: { 'scale.x': scaleX } },
})

describe('saved zoom templates', () => {
  test('a zoom that holds and returns becomes in, hold, and out', () => {
    const entry = saved(1600, [
      { t: 0, value: 1, easing: 'easeInOut' },
      { t: 0.22, value: 1.35 },
      { t: 0.78, value: 1.35 },
      { t: 1, value: 1 },
    ])
    expect(toSavedZoom(entry)).toEqual({ id: 'tpl-1', name: 'Mine', zoom: { scale: 1.35, inMs: 352, holdMs: 896, outMs: 352, easing: 'easeInOut' } })
  })

  test('a punch-in that never returns eases back out over its rise time', () => {
    const entry = saved(350, [
      { t: 0, value: 1 },
      { t: 1, value: 1.25 },
    ])
    expect(toSavedZoom(entry)?.zoom).toEqual({ scale: 1.25, inMs: 350, holdMs: 0, outMs: 350, easing: 'easeOutExpo' })
  })

  test('a template that never scales up has no zoom region form', () => {
    expect(
      toSavedZoom(
        saved(1000, [
          { t: 0, value: 1 },
          { t: 1, value: 1 },
        ]),
      ),
    ).toBeNull()
  })

  test('a peak at 1.001 or under has no zoom region form, and a peak just past it does', () => {
    const peaking = (value: number) =>
      saved(1000, [
        { t: 0, value: 1 },
        { t: 1, value },
      ])
    expect(toSavedZoom(peaking(1.0005))).toBeNull()
    expect(toSavedZoom(peaking(1.002))?.zoom.scale).toBe(1.002)
  })

  test('a peak past 8x converts at 8x', () => {
    expect(
      toSavedZoom(
        saved(1000, [
          { t: 0, value: 1 },
          { t: 1, value: 12 },
        ]),
      )?.zoom.scale,
    ).toBe(8)
  })

  test('a template with only a scale.y track converts from it', () => {
    const entry = {
      id: 'tpl-1',
      kind: 'zoom' as const,
      name: 'Mine',
      payload: {
        durationMs: 350,
        tracks: {
          'scale.y': [
            { t: 0, value: 1 },
            { t: 1, value: 1.25 },
          ],
        },
      },
    }
    expect(toSavedZoom(entry)?.zoom).toEqual({ scale: 1.25, inMs: 350, holdMs: 0, outMs: 350, easing: 'easeOutExpo' })
  })
})
