import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, parseProject, type Project, type VideoElement } from './model'

function projectWithVideo(): { project: Project; trackId: `t-${string}` } {
  let project = createProject({ name: 'test' })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000, width: 1920, height: 1080 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-v', type: 'video', assetId: 'a-vid', startMs: 0, durationMs: 4000 },
  })
  return { project, trackId }
}

const video = (project: Project): VideoElement =>
  project.tracks[0]!.elements[0] as VideoElement

describe('frame style fields', () => {
  test('updateElement sets cornerRadius, stroke, shadow, crop', () => {
    let { project } = projectWithVideo()
    project = applyCommand(project, {
      type: 'updateElement',
      elementId: 'e-v',
      patch: {
        cornerRadius: 0.12,
        stroke: { color: '#ffffff', width: 6 },
        shadow: { color: 'rgba(0,0,0,0.5)', blur: 20, offsetX: 0, offsetY: 8 },
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
      },
    })
    expect(video(project)).toMatchObject({
      cornerRadius: 0.12,
      stroke: { color: '#ffffff', width: 6 },
      crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
    })
  })

  test('rejects a crop extending past the source', () => {
    const { project } = projectWithVideo()
    expect(() =>
      applyCommand(project, {
        type: 'updateElement',
        elementId: 'e-v',
        patch: { crop: { x: 0.6, y: 0, w: 0.5, h: 1 } },
      }),
    ).toThrow(CommandError)
  })

  test('rejects out-of-range cornerRadius', () => {
    const { project } = projectWithVideo()
    expect(() =>
      applyCommand(project, {
        type: 'updateElement',
        elementId: 'e-v',
        patch: { cornerRadius: 0.75 },
      }),
    ).toThrow(CommandError)
  })

  test('styled elements and slot strokes round-trip serialization', () => {
    let { project } = projectWithVideo()
    project = applyCommand(project, {
      type: 'updateElement',
      elementId: 'e-v',
      patch: { cornerRadius: 0.1, shadow: { color: '#000', blur: 10, offsetX: 0, offsetY: 4 } },
    })
    project = applyCommand(project, {
      type: 'saveLayout',
      layout: {
        id: 'lay-1',
        name: 'PiP',
        slots: [
          {
            source: 'camera',
            rect: { x: 0.7, y: 0.7, w: 0.25, h: 0.25 },
            fit: 'cover',
            focus: { x: 0.5, y: 0.5 },
            cornerRadius: 0.12,
            shadow: true,
            stroke: { color: '#ffffff', width: 4 },
          },
        ],
      },
    })
    const restored = parseProject(JSON.parse(JSON.stringify(project)))
    expect(restored.tracks[0]!.elements[0]).toMatchObject({ cornerRadius: 0.1 })
    expect(restored.layouts[0]!.slots[0]!.stroke).toEqual({ color: '#ffffff', width: 4 })
  })
})
