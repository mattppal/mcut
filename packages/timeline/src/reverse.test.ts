import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { EditorEngine } from './engine'
import { createProject, parseProject, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import { getSourceTimeMs, makeConstantSpeedMap } from './speed'

describe('reversed source mapping', () => {
  test('plays the trimmed span backward', () => {
    const el = { startMs: 0, durationMs: 2000, trimStartMs: 500, reversed: true }
    expect(getSourceTimeMs(el, 0)).toBe(2500)
    expect(getSourceTimeMs(el, 1000)).toBe(1500)
    expect(getSourceTimeMs(el, 2000)).toBe(500)
  })

  test('composes with a constant-speed map', () => {
    const el = {
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      timeMap: makeConstantSpeedMap(1000, 2),
      reversed: true,
    }
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
    const sourceAt3000 = getSourceTimeMs(original, 3000)
    project = applyCommand(project, {
      type: 'splitElement',
      elementId: 'e-v',
      atMs: 2500,
      rightElementId: 'e-right',
    })
    const left = getElement(project, 'e-v') as VideoElement
    const right = getElement(project, 'e-right') as VideoElement

    expect(getSourceTimeMs(left, 0)).toBe(getSourceTimeMs(original, 0))
    expect(getSourceTimeMs(left, 2500)).toBe(getSourceTimeMs(original, 2500))
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

  test('split of a reversed speed-ramped clip keeps trimStartMs integral', () => {
    const engine = new EditorEngine()
    engine.dispatch({ type: 'addAsset', asset: { id: 'a-1', kind: 'video', src: 'x.mp4' } })
    engine.dispatch({
      type: 'addElement',
      trackId: 't-default',
      element: {
        id: 'e-ramp',
        type: 'video',
        assetId: 'a-1',
        startMs: 2862,
        durationMs: 3019,
        reversed: true,
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 329, value: 4128 },
        ],
      },
    })
    engine.dispatch({ type: 'splitElement', elementId: 'e-ramp', atMs: 2943 })
    const halves = (project: Project) =>
      project.tracks.flatMap((track) =>
        track.elements.flatMap((e) => (e.type === 'video' ? [[e.startMs, e.durationMs, e.trimStartMs]] : [])),
      )
    expect(halves(engine.project)).toEqual([
      [2862, 81, 3111],
      [2943, 2938, 0],
    ])
    expect(halves(parseProject(JSON.parse(JSON.stringify(engine.project))))).toEqual([
      [2862, 81, 3111],
      [2943, 2938, 0],
    ])
  })

  test('reversed clips stay inside their asset', () => {
    expect(() =>
      projectWithVideo({ trimStartMs: 7000, durationMs: 4000 }),
    ).toThrow(/plays past the end/)
  })
})
