import { describe, expect, test } from 'bun:test'
import {
  applyCommand,
  createProject,
  cubicBezierAt,
  evaluateEasing,
  expandAnimationPreset,
  getAnimatedValue,
  hasKeyframes,
  interpolateTrack,
  isOnKeyframe,
  resolveAnimatedElement,
  splitKeyframes,
  summarizeProject,
  textStyleSchema,
  upsertKeyframe,
  type Keyframe,
  type Project,
  type TextElement,
} from './index'

const textElement = (overrides: Partial<TextElement> = {}): TextElement => ({
  id: 'e-test',
  type: 'text',
  startMs: 1000,
  durationMs: 4000,
  text: 'hello',
  // Parse so style defaults (tracking, line height, …) stay in sync with the schema.
  style: textStyleSchema.parse({ fontSize: 64, color: '#fff' }),
  transform: { x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
  opacity: 1,
  ...overrides,
})

describe('easing', () => {
  test('linear and hold', () => {
    expect(evaluateEasing('linear', 0.25)).toBe(0.25)
    expect(evaluateEasing(undefined, 0.7)).toBe(0.7)
    expect(evaluateEasing('hold', 0.99)).toBe(0)
  })
  test('cubic bezier golden values', () => {
    // ease-in-out at midpoint is 0.5 by symmetry
    expect(cubicBezierAt([0.42, 0, 0.58, 1], 0.5)).toBeCloseTo(0.5, 4)
    // ease-out runs ahead of linear; ease-in lags behind; they mirror exactly
    expect(evaluateEasing('easeOut', 0.25)).toBeCloseTo(0.3784, 3)
    expect(evaluateEasing('easeIn', 0.25)).toBeLessThan(0.25)
    expect(evaluateEasing('easeIn', 0.25)).toBeCloseTo(1 - evaluateEasing('easeOut', 0.75), 4)
    expect(cubicBezierAt([0.42, 0, 1, 1], 0)).toBe(0)
    expect(cubicBezierAt([0.42, 0, 1, 1], 1)).toBe(1)
  })
})

describe('interpolateTrack', () => {
  const track: Keyframe[] = [
    { timeMs: 1000, value: 0 },
    { timeMs: 2000, value: 100, easing: 'hold' },
    { timeMs: 3000, value: 50 },
  ]
  test('Premiere out-of-range semantics: clamp to first/last value', () => {
    expect(interpolateTrack(track, 0)).toBe(0)
    expect(interpolateTrack(track, 5000)).toBe(50)
  })
  test('linear interpolation between keyframes', () => {
    expect(interpolateTrack(track, 1500)).toBe(50)
  })
  test('hold steps at the next keyframe', () => {
    expect(interpolateTrack(track, 2999)).toBe(100)
    expect(interpolateTrack(track, 3000)).toBe(50)
  })
})

describe('resolveAnimatedElement', () => {
  test('fast path: same reference without keyframes', () => {
    const element = textElement()
    expect(resolveAnimatedElement(element, 2000)).toBe(element)
  })
  test('armed properties override statics; unarmed keep statics', () => {
    const element = textElement({
      keyframes: {
        'position.x': [
          { timeMs: 0, value: -100 },
          { timeMs: 1000, value: 100 },
        ],
        opacity: [{ timeMs: 0, value: 0.5 }],
      },
    })
    // timeline 1500 = local 500 → x halfway, opacity from single kf, y static
    const resolved = resolveAnimatedElement(element, 1500)
    expect(resolved.transform.x).toBe(0)
    expect(resolved.transform.y).toBe(20)
    expect(resolved.opacity).toBe(0.5)
  })
  test('getAnimatedValue falls back to static when unarmed', () => {
    expect(getAnimatedValue(textElement(), 'rotation', 1234)).toBe(0)
  })
})

describe('upsertKeyframe', () => {
  test('keeps the track sorted and unique by time', () => {
    let track: Keyframe[] = []
    track = upsertKeyframe(track, { timeMs: 500, value: 1 })
    track = upsertKeyframe(track, { timeMs: 100, value: 2 })
    track = upsertKeyframe(track, { timeMs: 500, value: 3 })
    expect(track.map((k) => [k.timeMs, k.value])).toEqual([
      [100, 2],
      [500, 3],
    ])
  })
})

describe('splitKeyframes', () => {
  test('boundary keyframes keep the value continuous across the cut', () => {
    const { left, right } = splitKeyframes(
      { opacity: [{ timeMs: 0, value: 0 }, { timeMs: 2000, value: 1 }] },
      1000,
    )
    expect(left?.opacity?.at(-1)).toEqual({ timeMs: 1000, value: 0.5 })
    expect(right?.opacity?.[0]?.timeMs).toBe(0)
    expect(right?.opacity?.[0]?.value).toBe(0.5)
    expect(right?.opacity?.at(-1)).toEqual({ timeMs: 1000, value: 1 })
  })
  test('a side with no original keyframes still stays armed at the boundary value', () => {
    const { left, right } = splitKeyframes(
      { rotation: [{ timeMs: 100, value: 45 }, { timeMs: 400, value: 90 }] },
      2000,
    )
    expect(left?.rotation?.length).toBe(3)
    expect(right?.rotation).toEqual([{ timeMs: 0, value: 90 }])
  })
})

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function projectWithText(): { project: Project; elementId: `e-${string}` } {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { id: 'e-kf', type: 'text', startMs: 0, durationMs: 3000, text: 'hi' },
  })
  return { project, elementId: 'e-kf' }
}

describe('keyframe commands', () => {
  test('setKeyframe arms the property; clearKeyframes disarms', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, {
      type: 'setKeyframe',
      elementId,
      property: 'opacity',
      timeMs: 0,
      value: 0,
      easing: 'easeOut',
    })
    next = applyCommand(next, {
      type: 'setKeyframe',
      elementId,
      property: 'opacity',
      timeMs: 500,
      value: 1,
    })
    const element = next.tracks[0]!.elements[0]!
    expect(hasKeyframes(element, 'opacity')).toBe(true)
    expect(getAnimatedValue(element, 'opacity', 250)).toBeGreaterThan(0.5) // easeOut
    expect(isOnKeyframe(element, 'opacity', 500)).toBe(true)

    const cleared = applyCommand(next, { type: 'clearKeyframes', elementId, property: 'opacity' })
    expect(hasKeyframes(cleared.tracks[0]!.elements[0]!)).toBe(false)
  })

  test('rejects unsupported properties with a typed error', () => {
    const { project, elementId } = projectWithText()
    expect(() =>
      applyCommand(project, { type: 'setKeyframe', elementId, property: 'volume', timeMs: 0, value: 1 }),
    ).toThrow(/no animatable "volume"/)
  })

  test('moveKeyframe retimes and rejects collisions', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, { type: 'setKeyframe', elementId, property: 'rotation', timeMs: 0, value: 0 })
    next = applyCommand(next, { type: 'setKeyframe', elementId, property: 'rotation', timeMs: 1000, value: 90 })
    next = applyCommand(next, { type: 'moveKeyframe', elementId, property: 'rotation', fromTimeMs: 1000, toTimeMs: 1500 })
    const element = next.tracks[0]!.elements[0]!
    expect(element.keyframes?.rotation?.map((k) => k.timeMs)).toEqual([0, 1500])
    expect(() =>
      applyCommand(next, { type: 'moveKeyframe', elementId, property: 'rotation', fromTimeMs: 1500, toTimeMs: 0 }),
    ).toThrow(/already exists/)
  })

  test('setKeyframeEasing changes interpolation', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, { type: 'setKeyframe', elementId, property: 'opacity', timeMs: 0, value: 0 })
    next = applyCommand(next, { type: 'setKeyframe', elementId, property: 'opacity', timeMs: 1000, value: 1 })
    next = applyCommand(next, { type: 'setKeyframeEasing', elementId, property: 'opacity', timeMs: 0, easing: 'hold' })
    expect(getAnimatedValue(next.tracks[0]!.elements[0]!, 'opacity', 999)).toBe(0)
  })

  test('splitElement keeps armed motion continuous', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, { type: 'setKeyframe', elementId, property: 'position.x', timeMs: 0, value: 0 })
    next = applyCommand(next, { type: 'setKeyframe', elementId, property: 'position.x', timeMs: 3000, value: 300 })
    next = applyCommand(next, { type: 'splitElement', elementId, atMs: 1000, rightElementId: 'e-right' })
    const [left, right] = next.tracks[0]!.elements
    expect(getAnimatedValue(left!, 'position.x', 999)).toBeCloseTo(99.9, 0)
    expect(getAnimatedValue(right!, 'position.x', 1000)).toBeCloseTo(100, 0)
    expect(getAnimatedValue(right!, 'position.x', 4000)).toBe(300)
  })

  test('project JSON with keyframes round-trips through the schema', () => {
    const { project, elementId } = projectWithText()
    const next = applyCommand(project, {
      type: 'setKeyframe',
      elementId,
      property: 'scale.x',
      timeMs: 100,
      value: 1.4,
      easing: { cubicBezier: [0.34, 1.56, 0.64, 1] },
    })
    const reparsed = JSON.parse(JSON.stringify(next))
    const again = applyCommand(reparsed, { type: 'setKeyframe', elementId, property: 'scale.x', timeMs: 200, value: 1 })
    expect(again.tracks[0]!.elements[0]!.keyframes?.['scale.x']?.length).toBe(2)
  })
})

describe('applyAnimationPreset', () => {
  test('expands to editable keyframes (fade-in)', () => {
    const { project, elementId } = projectWithText()
    const next = applyCommand(project, {
      type: 'applyAnimationPreset',
      elementId,
      preset: 'fade-in',
      options: { durationMs: 400 },
    })
    const element = next.tracks[0]!.elements[0]!
    expect(getAnimatedValue(element, 'opacity', 0)).toBe(0)
    expect(getAnimatedValue(element, 'opacity', 400)).toBe(1)
    expect(getAnimatedValue(element, 'opacity', 3000)).toBe(1)
  })

  test('out presets anchor to the clip end; merging keeps in + out', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, { type: 'applyAnimationPreset', elementId, preset: 'fade-in' })
    next = applyCommand(next, { type: 'applyAnimationPreset', elementId, preset: 'fade-out' })
    const element = next.tracks[0]!.elements[0]!
    expect(getAnimatedValue(element, 'opacity', 0)).toBe(0)
    expect(getAnimatedValue(element, 'opacity', 1500)).toBe(1)
    expect(getAnimatedValue(element, 'opacity', 3000)).toBe(0)
  })

  test('expandAnimationPreset clamps duration to the element', () => {
    const element = textElement({ durationMs: 300, startMs: 0 })
    const expanded = expandAnimationPreset(element, 'fade-in', { durationMs: 5000 })
    expect(expanded.opacity?.at(-1)?.timeMs).toBe(300)
  })

  test('pop-in scales from a subtle 0.85, not a cartoonish crunch', () => {
    const element = textElement({ startMs: 0 })
    const expanded = expandAnimationPreset(element, 'pop-in')
    expect(expanded['scale.x']?.[0]?.value).toBeCloseTo(0.85, 5)
    // Overshoot easing on the way in.
    expect(expanded['scale.x']?.[0]?.easing).toEqual({ cubicBezier: [0.34, 1.56, 0.64, 1] })
  })

  test('blur-in writes a blur track that resolves to a blur effect', () => {
    const { project, elementId } = projectWithText()
    const next = applyCommand(project, { type: 'applyAnimationPreset', elementId, preset: 'blur-in' })
    const element = next.tracks[0]!.elements[0]!
    expect(getAnimatedValue(element, 'blur', 0)).toBe(16)
    expect(getAnimatedValue(element, 'blur', 450)).toBe(0)
    const atStart = resolveAnimatedElement(element, 0)
    expect('effects' in atStart ? atStart.effects : undefined).toEqual([
      { type: 'blur', enabled: true, radius: 16 },
    ])
    // Once sharp, no synthetic effect remains.
    const atEnd = resolveAnimatedElement(element, 1000)
    expect('effects' in atEnd ? atEnd.effects : undefined).toBeUndefined()
  })

  test('punch-zoom snaps tighter and HOLDS for the rest of the clip', () => {
    const { project, elementId } = projectWithText()
    const next = applyCommand(project, { type: 'applyAnimationPreset', elementId, preset: 'punch-zoom' })
    const element = next.tracks[0]!.elements[0]!
    expect(getAnimatedValue(element, 'scale.x', 0)).toBe(1)
    expect(getAnimatedValue(element, 'scale.x', 120)).toBeCloseTo(1.15, 5)
    expect(getAnimatedValue(element, 'scale.x', 3000)).toBeCloseTo(1.15, 5)
  })

  test('whip presets switch on motion blur; fades do not', () => {
    const { project, elementId } = projectWithText()
    const whipped = applyCommand(project, { type: 'applyAnimationPreset', elementId, preset: 'whip-in' })
    const whippedElement = whipped.tracks[0]!.elements[0]!
    expect('motionBlur' in whippedElement ? whippedElement.motionBlur : undefined).toEqual({
      enabled: true,
      shutterAngle: 180,
    })
    const faded = applyCommand(project, { type: 'applyAnimationPreset', elementId, preset: 'fade-in' })
    const fadedElement = faded.tracks[0]!.elements[0]!
    expect('motionBlur' in fadedElement ? fadedElement.motionBlur : undefined).toBeUndefined()
  })

  test('an explicit motion-blur choice survives applying a whip', () => {
    const { project, elementId } = projectWithText()
    let next = applyCommand(project, {
      type: 'setMotionBlur',
      elementId,
      motionBlur: { enabled: false, shutterAngle: 90 },
    })
    next = applyCommand(next, { type: 'applyAnimationPreset', elementId, preset: 'whip-in' })
    const element = next.tracks[0]!.elements[0]!
    expect('motionBlur' in element ? element.motionBlur : undefined).toEqual({
      enabled: false,
      shutterAngle: 90,
    })
  })
})

describe('blur property', () => {
  test('static value is 0 for visuals and unsupported elsewhere', () => {
    const element = textElement()
    expect(getAnimatedValue(element, 'blur', 0)).toBe(0)
  })

  test('animated blur stacks on top of existing effects', () => {
    const element = textElement({
      startMs: 0,
      effects: [{ type: 'sepia', enabled: true, amount: 1 }],
      keyframes: { blur: [{ timeMs: 0, value: 8 }] },
    })
    const resolved = resolveAnimatedElement(element, 0)
    expect(resolved.effects).toEqual([
      { type: 'sepia', enabled: true, amount: 1 },
      { type: 'blur', enabled: true, radius: 8 },
    ])
  })

  test('setMotionBlur rejects non-visual elements', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-au', kind: 'audio', src: 'blob:a', durationMs: 10_000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { id: 'e-au', type: 'audio', assetId: 'a-au', startMs: 0, durationMs: 1000 },
    })
    expect(() =>
      applyCommand(project, {
        type: 'setMotionBlur',
        elementId: 'e-au',
        motionBlur: { enabled: true, shutterAngle: 180 },
      }),
    ).toThrow()
  })
})

describe('summarizeProject', () => {
  test('renders keyframed properties in editor vocabulary', () => {
    const { project, elementId } = projectWithText()
    const next = applyCommand(project, { type: 'setKeyframe', elementId, property: 'opacity', timeMs: 0, value: 0 })
    const summary = summarizeProject(next)
    expect(summary).toContain('Project "Untitled" 1920×1080 @ 30fps')
    expect(summary).toContain('keyframed: opacity×1')
    expect(summary).toContain('text "hi"')
  })
})

describe('rippleDelete', () => {
  test('closes the gap on the affected track only', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, { type: 'addTrack', id: 't-other' })
    for (const [id, startMs] of [['e-a', 0], ['e-b', 4000], ['e-c', 9000]] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId,
        element: { id, type: 'text', startMs, durationMs: 2000, text: id },
      })
    }
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-other',
      element: { id: 'e-x', type: 'text', startMs: 5000, durationMs: 1000, text: 'x' },
    })

    const next = applyCommand(project, { type: 'rippleDelete', elementIds: ['e-b'] })
    const starts = Object.fromEntries(
      next.tracks.flatMap((t) => t.elements.map((e) => [e.id, e.startMs])),
    )
    expect(starts['e-a']).toBe(0)      // before the removal: unchanged
    expect(starts['e-c']).toBe(7000)   // shifted left by e-b's 2000ms
    expect(starts['e-x']).toBe(5000)   // other track untouched
  })

  test('multiple removals accumulate shifts; unknown ids reject', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    for (const [id, startMs] of [['e-1', 0], ['e-2', 3000], ['e-3', 6000]] as const) {
      project = applyCommand(project, {
        type: 'addElement',
        trackId,
        element: { id, type: 'text', startMs, durationMs: 1000, text: id },
      })
    }
    const next = applyCommand(project, { type: 'rippleDelete', elementIds: ['e-1', 'e-2'] })
    expect(next.tracks[0]!.elements.map((e) => [e.id, e.startMs])).toEqual([['e-3', 4000]])
    expect(() => applyCommand(project, { type: 'rippleDelete', elementIds: ['e-zzz'] })).toThrow(
      /no element/,
    )
  })
})
