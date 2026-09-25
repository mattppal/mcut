import { describe, expect, test } from 'bun:test'
import { applyCommand, type CommandOfType } from './commands'
import { EditorEngine } from './engine'
import { createProject, splitElementAt, type MulticamElement, type Project, type VideoElement } from './model'
import { centeredFocus, getReframeCenter } from './reframe'
import { getElement } from './selectors'
import { thrownBy } from './test-helpers'

const track = [
  { sourceMs: 1000, x: 0.25, y: 0.5 },
  { sourceMs: 2000, x: 0.75, y: 0.25 },
]

const crop = { x: 0.3418, y: 0, w: 0.3164, h: 1 }

function projectWithClips(): Project {
  let project = createProject({ width: 1280, height: 720 })
  const trackId = project.tracks[0]?.id ?? 't-default'
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 30_000 },
  })
  project = applyCommand(project, { type: 'addTrack' })
  const camTrack = project.tracks[1]?.id ?? 't-default'
  return applyCommand(project, {
    type: 'addElement',
    trackId: camTrack,
    element: { type: 'video', id: 'e-cam', assetId: 'a-cam', startMs: 2000, durationMs: 20_000, trimStartMs: 500 },
  })
}

function withMulticam(project: Project): Project {
  return applyCommand(project, { type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }], multicamId: 'e-mc' })
}

function video(project: Project, id: `e-${string}`): VideoElement {
  const element = getElement(project, id)
  if (element?.type !== 'video') throw new Error(`${id} is not a video`)
  return element
}

function multicam(project: Project): MulticamElement {
  const element = getElement(project, 'e-mc')
  if (element?.type !== 'multicam') throw new Error('e-mc is not a multicam')
  return element
}

describe('setReframe on a video', () => {
  test('writes the track and crop as one undo step, and a rerun adds no step', () => {
    const engine = new EditorEngine({ project: projectWithClips() })
    const before = engine.project
    const command: CommandOfType<'setReframe'> = { type: 'setReframe', elementId: 'e-cam', track, crop }
    engine.dispatch(command)
    const reframed = engine.project
    expect(video(reframed, 'e-cam')).toMatchObject({ reframe: track, crop })
    engine.dispatch(command)
    expect(engine.project).toBe(reframed)
    engine.undo()
    expect(engine.project).toBe(before)
    expect(engine.canUndo()).toBe(false)
  })

  test('null stops tracking and keeps the crop', () => {
    const tracked = applyCommand(projectWithClips(), { type: 'setReframe', elementId: 'e-cam', track, crop })
    expect(getReframeCenter(video(tracked, 'e-cam'), undefined, 2500)).toEqual({ x: 0.25, y: 0.5 })
    const cleared = video(applyCommand(tracked, { type: 'setReframe', elementId: 'e-cam', track: null }), 'e-cam')
    expect(getReframeCenter(cleared, undefined, 2500)).toBeNull()
    expect(cleared.crop).toEqual(crop)
  })

  test('a source key and elements without a picture are rejected', () => {
    let project = applyCommand(projectWithClips(), { type: 'addTrack' })
    const textTrack = project.tracks[2]?.id ?? 't-default'
    project = applyCommand(project, {
      type: 'addElement',
      trackId: textTrack,
      element: { type: 'text', id: 'e-title', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    expect(thrownBy(() => applyCommand(project, { type: 'setReframe', elementId: 'e-cam', source: 'camera', track }))).toMatchObject({
      code: 'invalid-payload',
      message: expect.stringContaining('multicam'),
    })
    expect(thrownBy(() => applyCommand(project, { type: 'setReframe', elementId: 'e-title', track }))).toMatchObject({
      code: 'invalid-payload',
      message: expect.stringContaining('"text"'),
    })
  })

  test('keys out of order are rejected at the payload', () => {
    const reversed = [...track].reverse()
    expect(thrownBy(() => applyCommand(projectWithClips(), { type: 'setReframe', elementId: 'e-cam', track: reversed }))).toMatchObject({
      code: 'invalid-payload',
      message: expect.stringContaining('strictly increasing'),
    })
  })
})

describe('setReframe on a multicam source', () => {
  test('tracks one angle, reruns as a no-op, names the sources on a miss, and rejects crop', () => {
    const project = applyCommand(withMulticam(projectWithClips()), { type: 'setReframe', elementId: 'e-mc', source: 'camera', track })
    expect(multicam(project).sources.map((s) => [s.key, s.reframe])).toEqual([
      ['screen', undefined],
      ['camera', track],
    ])
    expect(applyCommand(project, { type: 'setReframe', elementId: 'e-mc', source: 'camera', track })).toBe(project)
    for (const source of [undefined, 'face']) {
      expect(thrownBy(() => applyCommand(project, { type: 'setReframe', elementId: 'e-mc', source, track }))).toMatchObject({
        code: 'invalid-payload',
        message: expect.stringContaining('one of: screen, camera'),
      })
    }
    expect(thrownBy(() => applyCommand(project, { type: 'setReframe', elementId: 'e-mc', source: 'camera', track, crop }))).toMatchObject({
      code: 'invalid-payload',
      message: expect.stringContaining('crop'),
    })
  })
})

describe('getReframeCenter', () => {
  test('keys stay on their source frames through a trimmed start, a split, and a speed change', () => {
    const clip = video(applyCommand(projectWithClips(), { type: 'setReframe', elementId: 'e-cam', track }), 'e-cam')
    expect(getReframeCenter(clip, undefined, 2000)).toEqual({ x: 0.25, y: 0.5 })
    expect(getReframeCenter(clip, undefined, 2500)).toEqual({ x: 0.25, y: 0.5 })
    expect(getReframeCenter(clip, undefined, 3000)).toEqual({ x: 0.5, y: 0.375 })
    expect(getReframeCenter(clip, undefined, 9000)).toEqual({ x: 0.75, y: 0.25 })

    const { right } = splitElementAt(clip, 1000)
    expect(right.type === 'video' && getReframeCenter(right, undefined, 3250)).toEqual({ x: 0.625, y: 0.3125 })

    const fast = video(
      applyCommand(applyCommand(projectWithClips(), { type: 'setReframe', elementId: 'e-cam', track }), {
        type: 'setElementSpeed',
        elementId: 'e-cam',
        speed: 2,
      }),
      'e-cam',
    )
    expect(getReframeCenter(fast, undefined, 2250)).toEqual({ x: 0.25, y: 0.5 })
    expect(getReframeCenter(fast, undefined, 2500)).toEqual({ x: 0.5, y: 0.375 })
  })

  test('a multicam source reads its own track through its sync offset', () => {
    let project = withMulticam(projectWithClips())
    project = applyCommand(project, { type: 'setMulticamSourceOffset', elementId: 'e-mc', sourceKey: 'camera', offsetMs: 1000 })
    project = applyCommand(project, { type: 'setReframe', elementId: 'e-mc', source: 'camera', track })
    expect(multicam(project).startMs).toBe(0)
    expect(getReframeCenter(multicam(project), 'camera', 500)).toEqual({ x: 0.5, y: 0.375 })
    expect(getReframeCenter(multicam(project), 'screen', 500)).toBeNull()
  })
})

describe('centeredFocus', () => {
  test('centers the window on the subject until the window meets the frame edge', () => {
    expect(centeredFocus({ x: 0.375, y: 0.4375 }, { x: 0.5, y: 0.75 })).toEqual({ x: 0.25, y: 0.25 })
    expect(centeredFocus({ x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 })).toEqual({ x: 1, y: 0 })
    expect(centeredFocus({ x: 0.9, y: 0.5 }, { x: 1, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })
})
