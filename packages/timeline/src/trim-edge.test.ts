import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject, type Project, type VideoElement } from './model'
import { getElement } from './selectors'
import { getSourceTimeMs } from './speed'

function projectWithVideo(extra: Record<string, unknown> = {}): Project {
  let project = createProject({ name: 'trim-edge' })
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
      startMs: 1000,
      durationMs: 4000,
      trimStartMs: 2000,
      ...extra,
    },
  })
}

const el = (project: Project): VideoElement => getElement(project, 'e-v') as VideoElement

describe('trimEdge', () => {
  test('forward clip: shrinking the start consumes early source', () => {
    const project = applyCommand(projectWithVideo(), {
      type: 'trimEdge',
      elementId: 'e-v',
      edge: 'start',
      deltaMs: 500,
    })
    expect(el(project)).toMatchObject({ startMs: 1500, durationMs: 3500, trimStartMs: 2500 })
  })

  test('forward clip: growing the end reveals later source', () => {
    const project = applyCommand(projectWithVideo(), {
      type: 'trimEdge',
      elementId: 'e-v',
      edge: 'end',
      deltaMs: 1000,
    })
    expect(el(project)).toMatchObject({ startMs: 1000, durationMs: 5000, trimStartMs: 2000 })
  })

  test('reversed clip: shrinking the start keeps the remaining frames identical', () => {
    const before = projectWithVideo({ reversed: true })
    const original = el(before)
    // Frame playing at timeline 2500 (local 1500) before the trim…
    const frameAt2500 = getSourceTimeMs(original, 1500)
    const project = applyCommand(before, {
      type: 'trimEdge',
      elementId: 'e-v',
      edge: 'start',
      deltaMs: 500,
    })
    const after = el(project)
    expect(after.startMs).toBe(1500)
    expect(after.durationMs).toBe(3500)
    // …still plays at timeline 2500 (now local 1000) after it.
    expect(getSourceTimeMs(after, 1000)).toBe(frameAt2500)
    // The clip's END (local = duration) still shows the trim-in frame.
    expect(getSourceTimeMs(after, 3500)).toBe(getSourceTimeMs(original, 4000))
  })

  test('reversed clip: growing the end reveals EARLIER source (window slides down)', () => {
    const project = applyCommand(projectWithVideo({ reversed: true }), {
      type: 'trimEdge',
      elementId: 'e-v',
      edge: 'end',
      deltaMs: 1000,
    })
    const after = el(project)
    expect(after).toMatchObject({ durationMs: 5000, trimStartMs: 1000 })
    // The frame at the (unchanged) start of the clip is the same one.
    expect(getSourceTimeMs(after, 0)).toBe(6000) // trim 1000 + span 5000
  })

  test('reversed clip: growing the end past the media start is rejected', () => {
    expect(() =>
      applyCommand(projectWithVideo({ reversed: true }), {
        type: 'trimEdge',
        elementId: 'e-v',
        edge: 'end',
        deltaMs: 2500, // only 2000ms of pre-trim media exists
      }),
    ).toThrow()
  })

  test('zero delta is a no-op', () => {
    const before = projectWithVideo()
    const project = applyCommand(before, {
      type: 'trimEdge',
      elementId: 'e-v',
      edge: 'end',
      deltaMs: 0,
    })
    expect(project).toBe(before)
  })
})
