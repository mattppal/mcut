import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { getFrameRequests } from './frame-requests'
import { createProject, type MulticamElement, type Project } from './model'
import {
  getActiveAngleIndex,
  getActiveLayout,
  getAngleTransitionAt,
  getMulticamSourceTimeMs,
  splitAngles,
} from './multicam'
import { getElement } from './selectors'

function projectWithRecordings(): { project: Project; trackId: `t-${string}` } {
  let project = createProject({ name: 'mc', width: 1920, height: 1080 })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 2560, height: 1440 },
  })
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 58_000, width: 1920, height: 1080 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 30_000 },
  })
  project = applyCommand(project, {
    type: 'addTrack',
  })
  const camTrack = project.tracks[1]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId: camTrack,
    element: {
      type: 'video',
      id: 'e-cam',
      assetId: 'a-cam',
      startMs: 2000, // camera started 2s late on the timeline
      durationMs: 28_000,
      trimStartMs: 500,
    },
  })
  return { project, trackId }
}

function createMc(project: Project): Project {
  return applyCommand(project, {
    type: 'createMulticam',
    elementIds: ['e-screen', 'e-cam'],
    multicamId: 'e-mc',
  })
}

const mc = (p: Project) => getElement(p, 'e-mc' as `e-${string}`) as MulticamElement

describe('createMulticam', () => {
  test('infers roles, syncs by timeline alignment, seeds default layouts', () => {
    const { project } = projectWithRecordings()
    const next = createMc(project)
    const element = mc(next)

    expect(element.startMs).toBe(0)
    expect(element.durationMs).toBe(30_000)
    // Bottom layer = screen, top layer = camera.
    const screen = element.sources.find((s) => s.key === 'screen')!
    const camera = element.sources.find((s) => s.key === 'camera')!
    expect(screen.assetId).toBe('a-screen')
    expect(camera.assetId).toBe('a-cam')
    // Camera started 2s later with 500ms trim: at multicam 0 it has no
    // content yet → clamped to 0 (trim 500 - 2000 offset).
    expect(screen.trimStartMs).toBe(0)
    expect(camera.trimStartMs).toBe(0)
    expect(element.audioSource).toBe('camera')
    expect(element.angles).toEqual([{ atMs: 0, layoutId: next.layouts[0]!.id }])
    expect(next.layouts.length).toBeGreaterThanOrEqual(4)
    // Originals consumed.
    expect(getElement(next, 'e-screen' as `e-${string}`)).toBeUndefined()
    expect(getElement(next, 'e-cam' as `e-${string}`)).toBeUndefined()
  })

  test('roles follow stacking order even when the bottom clip is narrower', () => {
    let project = createProject({ name: 'mc', width: 1920, height: 1080 })
    const bottomTrack = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-narrow', kind: 'video', src: 'blob:n', durationMs: 30_000, width: 1080, height: 1920 },
    })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-wide', kind: 'video', src: 'blob:w', durationMs: 30_000, width: 2560, height: 1440 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: bottomTrack,
      element: { type: 'video', id: 'e-bottom', assetId: 'a-narrow', startMs: 0, durationMs: 10_000 },
    })
    project = applyCommand(project, { type: 'addTrack' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[1]!.id,
      element: { type: 'video', id: 'e-top', assetId: 'a-wide', startMs: 0, durationMs: 10_000 },
    })
    // Selection order must not matter either: top listed first.
    const next = applyCommand(project, {
      type: 'createMulticam',
      elementIds: ['e-top', 'e-bottom'],
      multicamId: 'e-mc',
    })
    const element = mc(next)
    expect(element.sources.find((s) => s.key === 'screen')!.assetId).toBe('a-narrow')
    expect(element.sources.find((s) => s.key === 'camera')!.assetId).toBe('a-wide')
  })

  test('rejects non-video selections', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'text', id: 'e-t', text: 'x', startMs: 0, durationMs: 1000 },
    })
    expect(() =>
      applyCommand(project, { type: 'createMulticam', elementIds: ['e-t'] }),
    ).toThrow(CommandError)
  })
})

describe('angle cuts', () => {
  function withCuts() {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 5000, layoutId: camLayout.id })
    return { next, camLayout }
  }

  test('addAngleCut keeps angles sorted; active angle resolves per time', () => {
    const { next, camLayout } = withCuts()
    const element = mc(next)
    expect(element.angles.map((a) => a.atMs)).toEqual([0, 5000])
    expect(getActiveAngleIndex(element.angles, 4999)).toBe(0)
    expect(getActiveAngleIndex(element.angles, 5000)).toBe(1)
    expect(getActiveLayout(next, element, 6000)?.id).toBe(camLayout.id)
  })

  test('moveAngleCut clamps between neighbors; first cut pinned', () => {
    const { next } = withCuts()
    const moved = applyCommand(next, { type: 'moveAngleCut', elementId: 'e-mc', fromMs: 5000, toMs: 8000 })
    expect(mc(moved).angles[1]!.atMs).toBe(8000)
    expect(() =>
      applyCommand(next, { type: 'moveAngleCut', elementId: 'e-mc', fromMs: 0, toMs: 100 }),
    ).toThrow(CommandError)
  })

  test('setAngleLayout corrects a span; removeAngleCut merges back', () => {
    const { next } = withCuts()
    const screenLayout = next.layouts.find((l) => l.name === 'Screen')!
    const corrected = applyCommand(next, {
      type: 'setAngleLayout',
      elementId: 'e-mc',
      atMs: 5000,
      layoutId: screenLayout.id,
    })
    expect(mc(corrected).angles[1]!.layoutId).toBe(screenLayout.id)
    const merged = applyCommand(next, { type: 'removeAngleCut', elementId: 'e-mc', atMs: 5000 })
    expect(mc(merged).angles).toHaveLength(1)
  })

  test('saveLayout defaults slot fit/focus (crop) when omitted', () => {
    const { project } = projectWithRecordings()
    const next = applyCommand(createMc(project), {
      type: 'saveLayout',
      layout: {
        id: 'lay-x',
        name: 'X',
        slots: [{ source: 'camera', rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }],
      },
    })
    const saved = next.layouts.find((l) => l.id === 'lay-x')!
    expect(saved.slots[0]!.fit).toBe('cover')
    expect(saved.slots[0]!.focus).toEqual({ x: 0.5, y: 0.5 })
  })

  test('removeLayout refuses while a cut uses it', () => {
    const { next, camLayout } = withCuts()
    expect(() =>
      applyCommand(next, { type: 'removeLayout', layoutId: camLayout.id }),
    ).toThrow(CommandError)
  })
})

describe('setMulticamSourceKey', () => {
  test('swaps roles when the new key is taken; audio stays with its role', () => {
    const { project } = projectWithRecordings()
    const next = applyCommand(createMc(project), {
      type: 'setMulticamSourceKey',
      elementId: 'e-mc',
      sourceKey: 'camera',
      newKey: 'screen',
    })
    const element = mc(next)
    expect(element.sources.find((s) => s.key === 'screen')!.assetId).toBe('a-cam')
    expect(element.sources.find((s) => s.key === 'camera')!.assetId).toBe('a-screen')
    // Audio keeps the 'camera' role, which now resolves to the other asset.
    expect(element.audioSource).toBe('camera')
  })

  test('plain rename carries the audio source along', () => {
    const { project } = projectWithRecordings()
    const next = applyCommand(createMc(project), {
      type: 'setMulticamSourceKey',
      elementId: 'e-mc',
      sourceKey: 'camera',
      newKey: 'narrator',
    })
    const element = mc(next)
    expect(element.sources.map((s) => s.key).sort()).toEqual(['narrator', 'screen'])
    expect(element.audioSource).toBe('narrator')
  })

  test('renaming to the same key is a no-op; unknown source throws', () => {
    const { project } = projectWithRecordings()
    const created = createMc(project)
    const same = applyCommand(created, {
      type: 'setMulticamSourceKey',
      elementId: 'e-mc',
      sourceKey: 'camera',
      newKey: 'camera',
    })
    expect(mc(same)).toEqual(mc(created))
    expect(() =>
      applyCommand(created, {
        type: 'setMulticamSourceKey',
        elementId: 'e-mc',
        sourceKey: 'webcam',
        newKey: 'camera',
      }),
    ).toThrow(CommandError)
  })
})

describe('angle transitions', () => {
  /** Screen-only at 0 → Camera-only at 5000, fade-black across every cut. */
  function withAngleTransition(durationMs = 1000) {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const screenLayout = next.layouts.find((l) => l.name === 'Screen')!
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'setAngleLayout', elementId: 'e-mc', atMs: 0, layoutId: screenLayout.id })
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 5000, layoutId: camLayout.id })
    next = applyCommand(next, {
      type: 'setMulticamAngleTransition',
      elementId: 'e-mc',
      transition: { type: 'fade-black', durationMs },
    })
    return { next, screenLayout, camLayout }
  }

  test('set/clear the uniform cut transition; unregistered types rejected', () => {
    const { next } = withAngleTransition()
    expect(mc(next).angleTransition).toEqual({ type: 'fade-black', durationMs: 1000 })
    const cleared = applyCommand(next, {
      type: 'setMulticamAngleTransition',
      elementId: 'e-mc',
      transition: null,
    })
    expect(mc(cleared).angleTransition).toBeUndefined()
    expect(() =>
      applyCommand(next, {
        type: 'setMulticamAngleTransition',
        elementId: 'e-mc',
        transition: { type: 'not-a-transition', durationMs: 500 },
      }),
    ).toThrow(CommandError)
  })

  test('getAngleTransitionAt windows each cut and stays null between cuts', () => {
    const { next, screenLayout, camLayout } = withAngleTransition()
    const element = mc(next)
    expect(getAngleTransitionAt(element, 4400)).toBeNull()
    expect(getAngleTransitionAt(element, 5600)).toBeNull()
    const window = getAngleTransitionAt(element, 4700)!
    expect(window).toEqual({
      type: 'fade-black',
      durationMs: 1000,
      cutMs: 5000,
      fromLayoutId: screenLayout.id,
      toLayoutId: camLayout.id,
    })
  })

  test('windows clamp to half the span between neighboring cuts', () => {
    const { next, screenLayout } = withAngleTransition(4000)
    const crowded = applyCommand(next, {
      type: 'addAngleCut',
      elementId: 'e-mc',
      atMs: 5400,
      layoutId: screenLayout.id,
    })
    const element = mc(crowded)
    // Cut at 5000: next cut 400ms away → half clamps to 200ms.
    expect(getAngleTransitionAt(element, 4810)!.durationMs).toBe(400)
    expect(getAngleTransitionAt(element, 4790)).toBeNull()
  })

  test('frame requests cover both layouts inside the window only', () => {
    const { next } = withAngleTransition()
    const element = mc(next)
    const assetsAt = (timeMs: number) =>
      getFrameRequests(next, element, timeMs).map((r) => r.assetId).sort()
    expect(assetsAt(4000)).toEqual(['a-screen'])
    expect(assetsAt(4800)).toEqual(['a-cam', 'a-screen'])
    expect(assetsAt(5200)).toEqual(['a-cam', 'a-screen'])
    expect(assetsAt(6000)).toEqual(['a-cam'])
  })
})

describe('source time + frame requests', () => {
  test('per-source trim feeds source time; requests follow the active layout', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    next = applyCommand(next, {
      type: 'setMulticamSourceTrim',
      elementId: 'e-mc',
      sourceKey: 'camera',
      trimStartMs: 1500,
    })
    const element = mc(next)
    const camera = element.sources.find((s) => s.key === 'camera')!
    expect(getMulticamSourceTimeMs(element, camera, 4000)).toBe(5500)

    // Default first layout is Screen + Cam → two requests.
    const both = getFrameRequests(next, element, 4000)
    expect(both.map((r) => r.assetId).sort()).toEqual(['a-cam', 'a-screen'])

    // Switch to Camera-only → one request.
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 0, layoutId: camLayout.id })
    const one = getFrameRequests(next, mc(next), 4000)
    expect(one).toEqual([{ assetId: 'a-cam', sourceTimeMs: 5500 }])
  })
})

describe('split + flatten', () => {
  test('splitting a multicam divides the switch list', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 10_000, layoutId: camLayout.id })
    next = applyCommand(next, { type: 'splitElement', elementId: 'e-mc', atMs: 6000, rightElementId: 'e-mc2' })

    const left = mc(next)
    const right = getElement(next, 'e-mc2' as `e-${string}`) as MulticamElement
    expect(left.angles).toEqual([{ atMs: 0, layoutId: next.layouts[0]!.id }])
    expect(right.angles.map((a) => a.atMs)).toEqual([0, 4000])
    // Source continuity: right half's sources advanced by the offset.
    expect(right.sources.find((s) => s.key === 'screen')!.trimStartMs).toBe(6000)
  })

  test('splitAngles helper keeps the active layout at the boundary', () => {
    const { left, right } = splitAngles(
      [
        { atMs: 0, layoutId: 'lay-a' },
        { atMs: 5000, layoutId: 'lay-b' },
      ],
      7000,
    )
    expect(left).toEqual([
      { atMs: 0, layoutId: 'lay-a' },
      { atMs: 5000, layoutId: 'lay-b' },
    ])
    expect(right[0]).toEqual({ atMs: 0, layoutId: 'lay-b' })
  })

  test('flatten explodes spans into plain clips + audio', () => {
    const { project } = projectWithRecordings()
    let next = createMc(project)
    const camLayout = next.layouts.find((l) => l.name === 'Camera')!
    next = applyCommand(next, { type: 'addAngleCut', elementId: 'e-mc', atMs: 12_000, layoutId: camLayout.id })
    next = applyCommand(next, { type: 'flattenMulticam', elementId: 'e-mc' })

    expect(getElement(next, 'e-mc' as `e-${string}`)).toBeUndefined()
    const all = next.tracks.flatMap((t) => t.elements)
    const videos = all.filter((e) => e.type === 'video')
    const audios = all.filter((e) => e.type === 'audio')
    // Span 1 (Screen + Cam) → 2 clips; span 2 (Camera) → 1 clip.
    expect(videos).toHaveLength(3)
    expect(audios).toHaveLength(1)
    expect(audios[0]).toMatchObject({ assetId: 'a-cam', startMs: 0, durationMs: 30_000 })
    // All flattened videos are muted (audio comes from the audio element).
    expect(videos.every((v) => v.type === 'video' && v.muted)).toBe(true)
  })
})
