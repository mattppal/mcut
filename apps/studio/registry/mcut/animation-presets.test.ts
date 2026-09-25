import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, getElement, getKeyframes } from '@mcut/timeline'
import { applyStudioAnimationPreset } from './animation-presets'

function setupTextClip() {
  const engine = new EditorEngine({ project: createProject() })
  const trackId = engine.project.tracks[0]!.id
  engine.dispatch({
    type: 'addElement',
    trackId,
    element: {
      id: 'e-preset-test',
      type: 'text',
      startMs: 0,
      durationMs: 2000,
      text: 'Punch',
    },
  })
  const element = getElement(engine.project, 'e-preset-test')
  if (!element) throw new Error('missing test element')
  return { engine, element }
}

describe('studio animation presets', () => {
  test('punch zoom starts at the playhead with editable scale keyframes', () => {
    const { engine, element } = setupTextClip()

    engine.seek(500)
    applyStudioAnimationPreset(engine, element, 'punch-zoom')

    const updated = getElement(engine.project, element.id)
    if (!updated) throw new Error('missing updated element')

    expect(getKeyframes(updated, 'scale.x').map((keyframe) => keyframe.timeMs)).toEqual([500, 740])
    expect(getKeyframes(updated, 'scale.y').map((keyframe) => keyframe.timeMs)).toEqual([500, 740])
    expect('motionBlur' in updated ? updated.motionBlur : undefined).toBeUndefined()
  })

  test('in presets start and out presets end at the playhead, clamped to the clip', () => {
    const { engine, element } = setupTextClip()

    engine.seek(800)
    applyStudioAnimationPreset(engine, element, 'fade-in')
    engine.seek(1200)
    applyStudioAnimationPreset(engine, element, 'fade-out')
    const placed = getElement(engine.project, element.id)
    if (!placed) throw new Error('missing placed element')
    expect(getKeyframes(placed, 'opacity').map((keyframe) => keyframe.timeMs)).toEqual([800, 950, 1100, 1200])

    engine.seek(1900)
    applyStudioAnimationPreset(engine, element, 'pop-in')
    const clamped = getElement(engine.project, element.id)
    if (!clamped) throw new Error('missing clamped element')
    expect(getKeyframes(clamped, 'scale.x').map((keyframe) => keyframe.timeMs)).toEqual([1650, 2000])
  })

  test('punch zoom preserves existing motion blur settings', () => {
    const { engine, element } = setupTextClip()
    engine.dispatch({
      type: 'setMotionBlur',
      elementId: element.id,
      motionBlur: { enabled: true, shutterAngle: 90 },
    })
    const blurred = getElement(engine.project, element.id)
    if (!blurred) throw new Error('missing blurred element')

    applyStudioAnimationPreset(engine, blurred, 'punch-zoom')

    const updated = getElement(engine.project, element.id)
    expect('motionBlur' in updated! ? updated!.motionBlur : undefined).toEqual({
      enabled: true,
      shutterAngle: 90,
    })
  })
})
