import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject, type Project, type TimelineElement } from './model'
import { mustFind } from './test-helpers'
import { captureThumbnailTemplate, expandThumbnailTemplate, findThumbnailTracks, THUMBNAIL_TEMPLATES, thumbnailDurationMs } from './thumbnails'

const textOf = (element: TimelineElement) => (element.type === 'text' ? element.text : element.type)
const template = (index: number) => mustFind(THUMBNAIL_TEMPLATES[index], `starter template ${index}`)
const trackTexts = (project: Project) => project.tracks.map((track) => track.elements.map(textOf))

describe('thumbnails', () => {
  test('cover spans exactly five frames, frame-quantized', () => {
    expect(thumbnailDurationMs(30)).toBe(167)
    expect(thumbnailDurationMs(60)).toBe(83)
  })

  test('expand scales geometry and fonts to the project size', () => {
    const small = expandThumbnailTemplate({ width: 1280, height: 720, fps: 30 }, THUMBNAIL_TEMPLATES[0]!)
    const big = expandThumbnailTemplate({ width: 3840, height: 2160, fps: 30 }, THUMBNAIL_TEMPLATES[0]!)
    expect(small.length).toBeGreaterThan(0)
    const smallText = small[0]! as Extract<(typeof small)[number], { type: 'text' }>
    const bigText = big[0]! as typeof smallText
    expect(bigText.style.fontSize / smallText.style.fontSize).toBeCloseTo(3, 1)
    expect(bigText.box!.width / smallText.box!.width).toBeCloseTo(3, 1)
  })

  test('applyThumbnail stacks one locked Thumbnail track per text layer on top', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(0) })
    expect(project.tracks.map((t) => t.name)).toEqual(['Track 1', 'Thumbnail', 'Thumbnail'])
    const layers = findThumbnailTracks(project)
    expect(layers.map((t) => t.locked)).toEqual([true, true])
    expect(layers.map((t) => t.elements.map(textOf))).toEqual([['BIG TITLE'], ['episode label']])
    expect(layers.flatMap((t) => t.elements.map((e) => [e.startMs, e.durationMs]))).toEqual([
      [0, 167],
      [0, 167],
    ])
  })

  test('a thumbnail headline stays editable after apply', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(0) })
    const elements = (p: Project) => p.tracks.flatMap((t) => t.elements)
    const headline = mustFind(
      elements(project).find((e) => textOf(e) === 'BIG TITLE'),
      'headline',
    )
    project = applyCommand(project, { type: 'updateElement', elementId: headline.id, patch: { text: 'NEW' } })
    expect(
      elements(project)
        .filter((e) => e.id === headline.id)
        .map(textOf),
    ).toEqual(['NEW'])
  })

  test('re-applying a template replaces the text layers', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(0) })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(2) })
    expect(project.tracks.map((t) => t.name)).toEqual(['Track 1', 'Thumbnail'])
    expect(trackTexts(project)).toEqual([[], ['ONE BIG WORD']])
  })

  test('re-applying keeps an image layer placed on a Thumbnail track', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-face', kind: 'image', src: 'blob:face', width: 400, height: 400 },
    })
    project = applyCommand(project, { type: 'addTrack', id: 't-face', name: 'Thumbnail' })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: 't-face',
      element: { id: 'e-face', type: 'image', assetId: 'a-face', startMs: 0, durationMs: 167 },
    })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(0) })
    project = applyCommand(project, { type: 'applyThumbnail', template: template(2) })
    expect(project.tracks.map((t) => t.name)).toEqual(['Track 1', 'Thumbnail', 'Thumbnail'])
    expect(trackTexts(project)).toEqual([[], ['image'], ['ONE BIG WORD']])
    expect(project.tracks.flatMap((t) => t.elements.map((e) => e.id))).toContain('e-face')
    expect(captureThumbnailTemplate(project, 'Mine')?.items.map((i) => i.kind)).toEqual(['slot', 'text'])
  })

  test('capture round-trips an applied cover', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: THUMBNAIL_TEMPLATES[0]! })
    const captured = captureThumbnailTemplate(project, 'Mine')!
    expect(captured.name).toBe('Mine')
    const texts = captured.items.filter((i) => i.kind === 'text')
    expect(texts.length).toBe(2)
    const original = THUMBNAIL_TEMPLATES[0]!.items.find((i) => i.kind === 'text')!
    const roundTripped = texts[0]!
    expect(Math.abs(roundTripped.rect.x - original.rect.x)).toBeLessThan(0.02)
    expect(roundTripped.style.fontSize).toBe(original.style.fontSize)
  })

  test('capture returns null without a cover', () => {
    expect(captureThumbnailTemplate(createProject(), 'x')).toBeNull()
  })

  test('expand scales tracking, stroke, and shadow with the font', () => {
    const big = expandThumbnailTemplate({ width: 3840, height: 2160, fps: 30 }, THUMBNAIL_TEMPLATES[0]!) as Array<
      Extract<ReturnType<typeof expandThumbnailTemplate>[number], { type: 'text' }>
    >
    const headlineTemplate = THUMBNAIL_TEMPLATES[0]!.items.find((i) => i.kind === 'text' && i.style.stroke) as Extract<
      (typeof THUMBNAIL_TEMPLATES)[number]['items'][number],
      { kind: 'text' }
    >
    const headline = big.find((e) => e.style.stroke)!
    expect(headline.style.stroke!.width).toBeCloseTo(headlineTemplate.style.stroke!.width * 2, 5)
    expect(headline.style.shadow!.blur).toBeCloseTo(headlineTemplate.style.shadow!.blur * 2, 5)
    const label = big.find((e) => e.style.letterSpacing > 0)!
    expect(label.style.letterSpacing).toBeCloseTo(2 * 2, 5)
  })
})
