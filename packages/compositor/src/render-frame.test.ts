import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { FakeContext2D } from './test-utils'
import type { Canvas2D, FrameSource } from './types'

class FakeSource implements FrameSource {
  requests: Array<{ assetId: string; sourceTimeMs: number }> = []
  frame: CanvasImageSource | null

  constructor(frame: CanvasImageSource | null = { width: 640, height: 360 } as CanvasImageSource) {
    this.frame = frame
  }

  getFrame(assetId: string, sourceTimeMs: number): CanvasImageSource | null {
    this.requests.push({ assetId, sourceTimeMs })
    return this.frame
  }
}

function videoProject(): Project {
  let project = createProject()
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:x', durationMs: 60_000, width: 640, height: 360 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: {
      id: 'e-vid',
      type: 'video',
      assetId: 'a-vid',
      startMs: 1000,
      durationMs: 5000,
      trimStartMs: 2000,
    },
  })
  return project
}

const asCtx = (fake: FakeContext2D): Canvas2D => fake as unknown as Canvas2D

describe('renderFrame', () => {
  test('draws active video with trim-adjusted source time', () => {
    const project = videoProject()
    const ctx = new FakeContext2D()
    const source = new FakeSource()
    renderFrame(asCtx(ctx), project, 3000, { source })
    expect(source.requests).toEqual([{ assetId: 'a-vid', sourceTimeMs: 4000 }])
    expect(ctx.callsTo('drawImage')).toHaveLength(1)
    // Centered draw of a 640x360 frame.
    expect(ctx.callsTo('drawImage')[0]!.args.slice(1)).toEqual([-320, -180, 640, 360])
  })

  test('skips elements outside their time range and hidden tracks', () => {
    let project = videoProject()
    const ctx = new FakeContext2D()
    const source = new FakeSource()
    renderFrame(asCtx(ctx), project, 500, { source })
    expect(source.requests).toHaveLength(0)

    project = applyCommand(project, {
      type: 'setTrackFlags',
      trackId: project.tracks[0]!.id,
      hidden: true,
    })
    renderFrame(asCtx(ctx), project, 3000, { source })
    expect(source.requests).toHaveLength(0)
  })

  test('paints background and renders text', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { type: 'text', startMs: 0, durationMs: 1000, text: 'hello\nworld' },
    })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 0, { backgroundColor: '#112233' })
    const bg = ctx.callsTo('fillRect')[0]!
    expect(bg.fillStyle).toBe('#112233')
    expect(bg.args).toEqual([0, 0, 1920, 1080])
    expect(ctx.callsTo('fillText').map((c) => c.args[0])).toEqual(['hello', 'world'])
  })

  test('caption highlights the active word', () => {
    let project = createProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: {
        id: 'e-cap',
        type: 'caption',
        startMs: 1000,
        durationMs: 2000,
        text: 'hello world',
        words: [
          { text: 'hello', startMs: 0, endMs: 500 },
          { text: 'world', startMs: 500, endMs: 1000 },
        ],
        style: { activeWordColor: '#ffcc00' },
      },
    })
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 1700, {}) // 700ms in → "world" active
    const texts = ctx.callsTo('fillText')
    expect(texts.map((c) => c.args[0])).toEqual(['hello', 'world'])
    expect(texts[0]!.fillStyle).toBe('#ffffff')
    expect(texts[1]!.fillStyle).toBe('#ffcc00')
  })

  test('video without a frame yet renders nothing but does not throw', () => {
    const project = videoProject()
    const ctx = new FakeContext2D()
    renderFrame(asCtx(ctx), project, 3000, { source: new FakeSource(null) })
    expect(ctx.callsTo('drawImage')).toHaveLength(0)
  })
})

describe('effects and blend modes', () => {
  test('effect stack compiles to ctx.filter during the draw and restores after', () => {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-fx', type: 'text', text: 'hi', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addEffect',
      elementId: 'e-fx',
      effect: { type: 'blur', radius: 6 },
    })
    project = applyCommand(project, {
      type: 'setBlendMode',
      elementId: 'e-fx',
      blendMode: 'screen',
    })
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 500)
    const textCalls = fake.callsTo('fillText')
    expect(textCalls.length).toBeGreaterThan(0)
    expect(textCalls[0]!.filter).toBe('blur(6px)')
    expect(textCalls[0]!.globalCompositeOperation).toBe('screen')
    // State restored after the element.
    expect(fake.filter).toBe('none')
    expect(fake.globalCompositeOperation).toBe('source-over')
  })
})

describe('transitions', () => {
  function adjacentTexts(transition: { type: string; durationMs: number }): Project {
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-l', type: 'text', text: 'LEFT', startMs: 0, durationMs: 2000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-r', type: 'text', text: 'RIGHT', startMs: 2000, durationMs: 2000 },
    })
    project = applyCommand(project, { type: 'setTransition', elementId: 'e-l', transition })
    return project
  }

  const textsDrawn = (fake: FakeContext2D) =>
    fake.callsTo('fillText').map((c) => c.args[0])

  test('dissolve renders both clips inside the window, right at partial alpha', () => {
    const project = adjacentTexts({ type: 'dissolve', durationMs: 1000 })
    const fake = new FakeContext2D()
    // Window is [1500, 2500); at 1750 completion = 0.25.
    renderFrame(asCtx(fake), project, 1750)
    const texts = textsDrawn(fake)
    expect(texts).toContain('LEFT')
    expect(texts).toContain('RIGHT')
    const rightCall = fake.callsTo('fillText').find((c) => c.args[0] === 'RIGHT')!
    expect(rightCall.globalAlpha).toBeCloseTo(0.25, 5)
  })

  test('outside the window only the active clip renders', () => {
    const project = adjacentTexts({ type: 'dissolve', durationMs: 1000 })
    const before = new FakeContext2D()
    renderFrame(asCtx(before), project, 1000)
    expect(textsDrawn(before)).toEqual(['LEFT'])
    const after = new FakeContext2D()
    renderFrame(asCtx(after), project, 3000)
    expect(textsDrawn(after)).toEqual(['RIGHT'])
  })

  test('wipe clips the incoming side to the revealed region', () => {
    const project = adjacentTexts({ type: 'wipe-right', durationMs: 1000 })
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 2000) // completion = 0.5
    const rects = fake.callsTo('rect')
    // Reveal rect: half the project width at completion 0.5.
    expect(rects.some((c) => (c.args[2] as number) === project.width / 2)).toBe(true)
    expect(fake.callsTo('clip').length).toBeGreaterThan(0)
    expect(textsDrawn(fake)).toEqual(['LEFT', 'RIGHT'])
  })

  test('fade-black veils toward the cut then unveils the right clip', () => {
    const project = adjacentTexts({ type: 'fade-black', durationMs: 1000 })
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 1750) // completion 0.25 → veil 0.5, still left
    expect(textsDrawn(fake)).toEqual(['LEFT'])
    const veil = fake
      .callsTo('fillRect')
      .find((c) => c.fillStyle === '#000000' && c.globalAlpha > 0 && c.globalAlpha < 1)
    expect(veil).toBeDefined()
    expect(veil!.globalAlpha).toBeCloseTo(0.5, 5)
  })

  test('broken adjacency renders normally (no blend)', () => {
    let project = adjacentTexts({ type: 'dissolve', durationMs: 1000 })
    project = applyCommand(project, { type: 'moveElement', elementId: 'e-r', startMs: 2500 })
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 1900)
    expect(textsDrawn(fake)).toEqual(['LEFT'])
  })
})

describe('multicam rendering', () => {
  function multicamProject(): { project: Project; layoutIds: { both: string; cam: string } } {
    let project = createProject({ width: 1920, height: 1080 })
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 2560, height: 1440 },
    })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000, width: 1920, height: 1080 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', id: 'e-s', assetId: 'a-screen', startMs: 0, durationMs: 10_000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { type: 'video', id: 'e-c', assetId: 'a-cam', startMs: 10_000, durationMs: 10_000 },
    })
    // Make them concurrent on separate tracks for a real multicam.
    project = applyCommand(project, { type: 'addTrack' })
    project = applyCommand(project, {
      type: 'moveElement',
      elementId: 'e-c',
      startMs: 0,
      toTrackId: project.tracks[1]!.id,
    })
    project = applyCommand(project, {
      type: 'createMulticam',
      elementIds: ['e-s', 'e-c'],
      multicamId: 'e-mc',
    })
    const both = project.layouts.find((l) => l.name === 'Screen + Cam')!.id
    const cam = project.layouts.find((l) => l.name === 'Camera')!.id
    project = applyCommand(project, { type: 'addAngleCut', elementId: 'e-mc', atMs: 5000, layoutId: cam })
    return { project, layoutIds: { both, cam } }
  }

  test('draws every slot of the active layout, then switches at the cut', () => {
    const { project } = multicamProject()
    const source = new FakeSource()

    const fakeA = new FakeContext2D()
    renderFrame(asCtx(fakeA), project, 1000, { source })
    // Screen + Cam: two drawImage calls (screen full + camera PiP).
    expect(fakeA.callsTo('drawImage')).toHaveLength(2)
    expect(source.requests.map((r) => r.assetId).sort()).toEqual(['a-cam', 'a-screen'])

    const fakeB = new FakeContext2D()
    source.requests = []
    renderFrame(asCtx(fakeB), project, 6000, { source })
    // Camera only after the cut.
    expect(fakeB.callsTo('drawImage')).toHaveLength(1)
    expect(source.requests.map((r) => r.assetId)).toEqual(['a-cam'])
  })

  test('PiP slot rounds and clips', () => {
    const { project } = multicamProject()
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 1000, { source: new FakeSource() })
    // The camera PiP has a corner radius → roundRect + clip.
    expect(fake.callsTo('roundRect').length).toBeGreaterThan(0)
    expect(fake.callsTo('clip').length).toBeGreaterThan(0)
  })

  test('angleTransition blends every cut through the transition registry', () => {
    let { project } = multicamProject()
    project = applyCommand(project, {
      type: 'setMulticamAngleTransition',
      elementId: 'e-mc',
      transition: { type: 'fade-white', durationMs: 1000 },
    })

    // At the cut the fade veil peaks: a full-canvas white fillRect.
    const atCut = new FakeContext2D()
    renderFrame(asCtx(atCut), project, 5000, { source: new FakeSource() })
    expect(atCut.callsTo('fillRect').some((c) => c.fillStyle === '#ffffff')).toBe(true)

    // Outside the window: plain single-layout render, no veil.
    const outside = new FakeContext2D()
    renderFrame(asCtx(outside), project, 1000, { source: new FakeSource() })
    expect(outside.callsTo('fillRect').some((c) => c.fillStyle === '#ffffff')).toBe(false)

    // A dissolve draws BOTH layouts inside the window (2 slots + 1 slot).
    project = applyCommand(project, {
      type: 'setMulticamAngleTransition',
      elementId: 'e-mc',
      transition: { type: 'dissolve', durationMs: 1000 },
    })
    const blending = new FakeContext2D()
    renderFrame(asCtx(blending), project, 4800, { source: new FakeSource() })
    expect(blending.callsTo('drawImage')).toHaveLength(3)
  })
})

describe('extensibility (compositor half)', () => {
  test('a custom element type + renderer paints through renderFrame', async () => {
    const { registerTimelineElementType, transformSchema } = await import('@mcut/timeline')
    const { z } = await import('zod')
    const { registerElementRenderer } = await import('./renderers')

    registerTimelineElementType({
      type: 'badge',
      shape: { label: z.string(), transform: transformSchema, opacity: z.number().default(1) },
    })
    registerElementRenderer('badge', (element, context) => {
      context.ctx.fillText((element as unknown as { label: string }).label, 0, 0)
    })

    let project = createProject()
    project = applyCommand(project, {
      type: 'addElement',
      trackId: project.tracks[0]!.id,
      element: { type: 'badge', label: 'LIVE', startMs: 0, durationMs: 1000 },
    })
    const fake = new FakeContext2D()
    renderFrame(asCtx(fake), project, 500)
    expect(fake.callsTo('fillText').map((c) => c.args[0])).toContain('LIVE')
  })

  test('a custom transition renderer blends; unrendered types hard-cut', async () => {
    const { registerTransitionType } = await import('@mcut/timeline')
    const { registerTransitionRenderer } = await import('./transition-renderers')

    registerTransitionType({ type: 'flash' })
    let project = createProject()
    const trackId = project.tracks[0]!.id
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-l', type: 'text', text: 'L', startMs: 0, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-r', type: 'text', text: 'R', startMs: 1000, durationMs: 1000 },
    })
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-l',
      transition: { type: 'flash', durationMs: 400 },
    })

    // No renderer yet: degrade to a hard cut (right after the cut point).
    const cutOnly = new FakeContext2D()
    renderFrame(asCtx(cutOnly), project, 1100)
    expect(cutOnly.callsTo('fillText').map((c) => c.args[0])).toEqual(['R'])

    registerTransitionRenderer('flash', ({ ctx, project: p, drawRight }) => {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, p.width, p.height)
      drawRight()
    })
    const flashed = new FakeContext2D()
    renderFrame(asCtx(flashed), project, 1100)
    expect(flashed.callsTo('fillText').map((c) => c.args[0])).toEqual(['R'])
    expect(flashed.callsTo('fillRect').some((c) => c.fillStyle === '#fff')).toBe(true)
  })
})
