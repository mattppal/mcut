import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import { getSourceTimeMs, makeConstantSpeedMap } from './speed'

describe('reversed source mapping', () => {
  test('plays the trimmed span backward', () => {
    const el = { startMs: 0, durationMs: 2000, trimStartMs: 500, reversed: true }
    expect(getSourceTimeMs(el, 0)).toBe(2500) // trim + span
    expect(getSourceTimeMs(el, 1000)).toBe(1500)
    expect(getSourceTimeMs(el, 2000)).toBe(500) // back at the trim-in
  })

  test('composes with a constant-speed map', () => {
    const el = {
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      timeMap: makeConstantSpeedMap(1000, 2),
      reversed: true,
    }
    // 2x over 1000ms output consumes 2000ms of source, backward.
    expect(getSourceTimeMs(el, 0)).toBe(2000)
    expect(getSourceTimeMs(el, 500)).toBe(1000)
    expect(getSourceTimeMs(el, 1000)).toBe(0)
  })

  test('forward mapping is unchanged', () => {
    const el = { startMs: 0, durationMs: 2000, trimStartMs: 500 }
    expect(getSourceTimeMs(el, 250)).toBe(750)
  })
})

describe('splitting reversed clips', () => {
  function projectWithVideo(extra: Record<string, unknown> = {}): Project {
    let project = createProject({ name: 'reverse' })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000 },
    })
    return applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: {
        type: 'video',
        id: 'e-v',
        assetId: 'a-vid',
        startMs: 0,
        durationMs: 4000,
        trimStartMs: 1000,
        reversed: true,
        ...extra,
      },
    })
  }

  test('halves keep playing the same source frames (no timeMap)', () => {
    let project = projectWithVideo()
    const original = getElement(project, 'e-v') as VideoElement
    // Source at the original timeline time 3000 (local 3000).
    const sourceAt3000 = getSourceTimeMs(original, 3000)
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-v',
      atMs: 2500,
      rightElementId: 'e-right',
    })
    const left = getElement(project, 'e-v') as VideoElement
    const right = getElement(project, 'e-right') as VideoElement

    // Left half holds the LATER source span: original local 0..2500.
    expect(getSourceTimeMs(left, 0)).toBe(getSourceTimeMs(original, 0))
    expect(getSourceTimeMs(left, 2500)).toBe(getSourceTimeMs(original, 2500))
    // Right half: original local 2500..4000 maps to right-local 0..1500.
    expect(getSourceTimeMs(right, 0)).toBe(getSourceTimeMs(original, 2500))
    expect(getSourceTimeMs(right, 500)).toBe(sourceAt3000)
    expect(getSourceTimeMs(right, 1500)).toBe(getSourceTimeMs(original, 4000))
    expect(left.reversed).toBe(true)
    expect(right.reversed).toBe(true)
  })

  test('halves keep playing the same source frames (with timeMap)', () => {
    let project = projectWithVideo({
      trimStartMs: 0,
      timeMap: makeConstantSpeedMap(4000, 2),
    })
    const original = getElement(project, 'e-v') as VideoElement
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-v',
      atMs: 1000,
      rightElementId: 'e-right',
    })
    const left = getElement(project, 'e-v') as VideoElement
    const right = getElement(project, 'e-right') as VideoElement
    expect(getSourceTimeMs(left, 0)).toBe(getSourceTimeMs(original, 0))
    expect(getSourceTimeMs(left, 1000)).toBe(getSourceTimeMs(original, 1000))
    expect(getSourceTimeMs(right, 0)).toBe(getSourceTimeMs(original, 1000))
    expect(getSourceTimeMs(right, 3000)).toBe(getSourceTimeMs(original, 4000))
  })

  test('reversed clips stay inside their asset', () => {
    // Same validation as forward: trim + span may not exceed the asset.
    expect(() =>
      projectWithVideo({ trimStartMs: 7000, durationMs: 4000 }),
    ).toThrow(/plays past the end/)
  })
})
