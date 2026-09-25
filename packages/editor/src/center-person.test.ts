import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, getElement, type Project } from '@mcut/timeline'
import { centerPersonOptionsSchema, planCenterPerson, type CenterPersonOptions, type FaceSample } from './center-person'
import { OperatorError } from './operators'

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

const defaults = centerPersonOptionsSchema.parse({})

function projectWithCamera(dimensions: { width?: number; height?: number } = { width: 1280, height: 720 }, size = { width: 1920, height: 1080 }): Project {
  let project = createProject(size)
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, ...dimensions } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 1920, height: 1080 } })
  project = applyCommand(project, {
    type: 'addElement',
    trackId: 't-default',
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 20_000 },
  })
  project = applyCommand(project, { type: 'addTrack' })
  const camTrack = project.tracks[1]?.id ?? 't-default'
  return applyCommand(project, {
    type: 'addElement',
    trackId: camTrack,
    element: { type: 'video', id: 'e-cam', assetId: 'a-cam', startMs: 0, durationMs: 20_000 },
  })
}

function faces(seconds: number, centerAt: (sourceMs: number) => number | null): FaceSample[] {
  return Array.from({ length: seconds * 5 + 1 }, (_, index) => {
    const sourceMs = index * 200
    const x = centerAt(sourceMs)
    return { sourceMs, box: x === null ? null : { x: x - 0.05, y: 0.3, w: 0.1, h: 0.2 } }
  })
}

const verticalCamera = () => projectWithCamera(undefined, { width: 1080, height: 1920 })

const pipCamera = () =>
  applyCommand(projectWithCamera(), {
    type: 'updateElement',
    elementId: 'e-cam',
    patch: { transform: { x: 640, y: 300, scaleX: 0.25, scaleY: 0.25, rotation: 0 } },
  })

function cameraTransformAfter(project: Project, options: Partial<CenterPersonOptions>) {
  const plan = planCenterPerson(
    project,
    { elementId: 'e-cam' },
    faces(1, () => 0.5),
    { ...defaults, ...options },
  )
  const camera = getElement(
    plan.reduce<Project>((next, command) => applyCommand(next, command), project),
    'e-cam',
  )
  return camera?.type === 'video' ? camera.transform : undefined
}

describe('planCenterPerson', () => {
  test('one jump pans once, settles on the new center, and dispatches as a valid setReframe', () => {
    const project = projectWithCamera()
    const [command] = planCenterPerson(
      project,
      { elementId: 'e-cam' },
      faces(10, (ms) => (ms < 4000 ? 0.3 : 0.7)),
      defaults,
    )
    const track = command.track ?? []
    const xs = track.map((key) => key.x)
    expect(xs[0]).toBe(0.3)
    expect(xs.at(-1)).toBe(0.7)
    expect(xs.every((x, index) => index === 0 || x >= (xs[index - 1] ?? x))).toBe(true)
    const settledMs = track.find((key) => key.x > 0.69)?.sourceMs ?? 0
    expect(settledMs).toBeGreaterThan(5000)
    expect(settledMs).toBeLessThan(7000)
    expect(track.filter((key) => key.sourceMs < 3800 || key.sourceMs > 7000).map((key) => key.sourceMs)).toEqual([0, 10_000])
    expect(new Set(track.map((key) => key.y))).toEqual(new Set([0.5]))

    const camera = getElement(applyCommand(project, command), 'e-cam')
    expect(camera?.type === 'video' && camera.reframe).toEqual(track)
  })

  test('a sway inside the dead zone keeps the frame still, and zero smoothing follows it', () => {
    const sway = faces(10, (ms) => (Math.floor(ms / 2000) % 2 === 0 ? 0.5 : 0.52))
    expect(planCenterPerson(projectWithCamera(), { elementId: 'e-cam' }, sway, defaults)[0].track).toEqual([
      { sourceMs: 0, x: 0.5, y: 0.5 },
      { sourceMs: 10_000, x: 0.5, y: 0.5 },
    ])
    const [tight] = planCenterPerson(projectWithCamera(), { elementId: 'e-cam' }, sway, { ...defaults, smoothing: 0 })
    expect(Math.max(...(tight.track ?? []).map((key) => key.x))).toBeCloseTo(0.52, 3)
  })

  test('leading misses take the first face and gaps hold the last one', () => {
    const gappy = faces(10, (ms) => (ms < 1000 || (ms > 5000 && ms < 7000) ? null : 0.3))
    expect(planCenterPerson(projectWithCamera(), { elementId: 'e-cam' }, gappy, defaults)[0].track).toEqual([
      { sourceMs: 0, x: 0.3, y: 0.5 },
      { sourceMs: 10_000, x: 0.3, y: 0.5 },
    ])
  })

  test('the video crop is the largest centered window of the aspect', () => {
    const still = faces(1, () => 0.5)
    expect(planCenterPerson(projectWithCamera(), { elementId: 'e-cam' }, still, defaults)[0].crop).toEqual({ x: 0.3418, y: 0, w: 0.3164, h: 1 })
    expect(planCenterPerson(projectWithCamera({ width: 720, height: 1280 }), { elementId: 'e-cam' }, still, { ...defaults, aspect: 16 / 9 })[0].crop).toEqual({
      x: 0,
      y: 0.3418,
      w: 1,
      h: 0.3164,
    })
  })

  test('a crop at the project aspect also fills the frame, and another aspect keeps the picture in picture size', () => {
    expect(cameraTransformAfter(verticalCamera(), { aspect: 9 / 16 })).toEqual({ x: 0, y: 0, scaleX: 2.6667, scaleY: 2.6667, rotation: 0 })
    expect(cameraTransformAfter(verticalCamera(), { aspect: 0.55 })).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
    expect(cameraTransformAfter(pipCamera(), { aspect: 9 / 16 })).toEqual({ x: 640, y: 300, scaleX: 0.25, scaleY: 0.25, rotation: 0 })
  })

  test('fill true fills at any aspect and fill false keeps the size at the project aspect', () => {
    expect(cameraTransformAfter(pipCamera(), { fill: true })).toEqual({ x: 0, y: 0, scaleX: 4.7408, scaleY: 4.7408, rotation: 0 })
    expect(cameraTransformAfter(verticalCamera(), { fill: false })).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  })

  test('a multicam source keeps the raw face center, gets no crop, and ignores fill', () => {
    const project = applyCommand(projectWithCamera(), {
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }],
      multicamId: 'e-mc',
    })
    expect(
      planCenterPerson(
        project,
        { elementId: 'e-mc', source: 'camera' },
        faces(2, () => 0.3),
        { ...defaults, fill: true },
      ),
    ).toEqual([
      {
        type: 'setReframe',
        elementId: 'e-mc',
        source: 'camera',
        track: [
          { sourceMs: 0, x: 0.3, y: 0.4 },
          { sourceMs: 2000, x: 0.3, y: 0.4 },
        ],
      },
    ])
  })

  test('no face, a video without dimensions, and a text element are refused', () => {
    const noFace = thrownBy(() =>
      planCenterPerson(
        projectWithCamera(),
        { elementId: 'e-cam' },
        faces(2, () => null),
        defaults,
      ),
    )
    expect(noFace).toBeInstanceOf(OperatorError)
    expect(noFace).toMatchObject({ code: 'invalid-payload', message: expect.stringContaining('no face in 11 samples') })
    expect(
      thrownBy(() =>
        planCenterPerson(
          projectWithCamera({}),
          { elementId: 'e-cam' },
          faces(2, () => 0.5),
          defaults,
        ),
      ),
    ).toMatchObject({
      code: 'unsupported',
    })
    const withTitle = applyCommand(applyCommand(projectWithCamera(), { type: 'addTrack' }), {
      type: 'addElement',
      trackId: 't-default',
      element: { type: 'text', id: 'e-title', text: 'hi', startMs: 20_000, durationMs: 1000 },
    })
    expect(
      thrownBy(() =>
        planCenterPerson(
          withTitle,
          { elementId: 'e-title' },
          faces(2, () => 0.5),
          defaults,
        ),
      ),
    ).toMatchObject({
      code: 'invalid-payload',
      message: expect.stringContaining('"text"'),
    })
  })
})
