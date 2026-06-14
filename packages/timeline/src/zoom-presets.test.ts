import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { getKeyframes } from './keyframes'
import { createProject, type Project, type TextElement } from './model'
import { getElement } from './selectors'
import { captureZoomPreset, expandZoomPreset, ZOOM_PRESETS } from './zoom-presets'

function projectWithText(scale = 1): Project {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: {
      type: 'text',
      id: 'e-t',
      text: 'hi',
      startMs: 1000,
      durationMs: 5000,
      transform: { x: 100, y: 0, scaleX: scale, scaleY: scale, rotation: 0 },
    },
  })
  return project
}

describe('applyZoomPreset', () => {
  test('expands relative values against the current framing', () => {
    const project = projectWithText(2) // clip already scaled 2x
    const punchIn = ZOOM_PRESETS.find((p) => p.name === 'Punch in')!
    const next = applyCommand(project, {
      type: 'applyZoomPreset',
      elementId: 'e-t',
      preset: punchIn,
      atMs: 500,
    })
    const element = getElement(next, 'e-t' as `e-${string}`)!
    const scaleTrack = getKeyframes(element, 'scale.x')
    expect(scaleTrack.map((k) => k.timeMs)).toEqual([500, 850])
    // Multiplier semantics: 2 × 1 → 2, 2 × 1.25 → 2.5.
    expect(scaleTrack.map((k) => k.value)).toEqual([2, 2.5])
  })

  test('replaces keyframes inside the window, keeps the rest', () => {
    let project = projectWithText()
    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-t',
      property: 'scale.x',
      timeMs: 600, // inside the window — will be replaced
      value: 3,
    })
    project = applyCommand(project, {
      type: 'setKeyframe',
      elementId: 'e-t',
      property: 'scale.x',
      timeMs: 4000, // outside — survives
      value: 1.5,
    })
    const punchIn = ZOOM_PRESETS.find((p) => p.name === 'Punch in')!
    const next = applyCommand(project, {
      type: 'applyZoomPreset',
      elementId: 'e-t',
      preset: punchIn,
      atMs: 500,
      durationMs: 400,
    })
    const track = getKeyframes(getElement(next, 'e-t' as `e-${string}`)!, 'scale.x')
    expect(track.map((k) => k.timeMs)).toEqual([500, 900, 4000])
    expect(track[2]!.value).toBe(1.5)
  })
})

describe('captureZoomPreset', () => {
  test('round-trips: capture from one clip, apply to another framing', () => {
    // Hand-animate a punch on a clip framed at scale 1.
    let project = projectWithText(1)
    for (const [timeMs, value] of [
      [1000, 1],
      [1400, 1.4],
    ] as const) {
      for (const property of ['scale.x', 'scale.y'] as const) {
        project = applyCommand(project, {
          type: 'setKeyframe',
          elementId: 'e-t',
          property,
          timeMs,
          value,
        })
      }
    }
    const element = getElement(project, 'e-t' as `e-${string}`)! as TextElement
    const preset = captureZoomPreset(element, 'My punch')!
    expect(preset.durationMs).toBe(400)
    expect(preset.tracks['scale.x']!.map((k) => k.value)).toEqual([1, 1.4])

    // Apply to a clip already at 2x: relative multipliers rescale.
    const expanded = expandZoomPreset(
      { ...element, keyframes: undefined, transform: { ...element.transform, scaleX: 2, scaleY: 2 } },
      preset,
      0,
    )
    expect(expanded['scale.x']!.map((k) => k.value)).toEqual([2, 2.8])
  })

  test('returns null with no zoomable keyframes', () => {
    const project = projectWithText()
    const element = getElement(project, 'e-t' as `e-${string}`)!
    expect(captureZoomPreset(element, 'x')).toBeNull()
  })
})
