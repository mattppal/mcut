import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createProject } from './model'
import {
  captureThumbnailTemplate,
  expandThumbnailTemplate,
  findThumbnailTrack,
  THUMBNAIL_TEMPLATES,
  thumbnailDurationMs,
} from './thumbnails'

describe('thumbnails', () => {
  test('cover spans exactly five frames, frame-quantized', () => {
    expect(thumbnailDurationMs(30)).toBe(167)
    expect(thumbnailDurationMs(60)).toBe(83)
  })

  test('expand scales geometry and fonts to the project size', () => {
    const small = expandThumbnailTemplate(
      { width: 1280, height: 720, fps: 30 },
      THUMBNAIL_TEMPLATES[0]!,
    )
    const big = expandThumbnailTemplate(
      { width: 3840, height: 2160, fps: 30 },
      THUMBNAIL_TEMPLATES[0]!,
    )
    expect(small.length).toBeGreaterThan(0)
    const smallText = small[0]! as Extract<(typeof small)[number], { type: 'text' }>
    const bigText = big[0]! as typeof smallText
    // 3x the height → 3x the font.
    expect(bigText.style.fontSize / smallText.style.fontSize).toBeCloseTo(3, 1)
    expect(bigText.box!.width / smallText.box!.width).toBeCloseTo(3, 1)
  })

  test('applyThumbnail creates a locked topmost track and re-apply replaces text', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: THUMBNAIL_TEMPLATES[0]! })
    const track = findThumbnailTrack(project)!
    expect(track.locked).toBe(true)
    expect(project.tracks[project.tracks.length - 1]!.id).toBe(track.id) // topmost
    const count = track.elements.length
    expect(count).toBeGreaterThan(0)
    expect(track.elements.every((e) => e.durationMs === thumbnailDurationMs(30))).toBe(true)

    // Re-apply with another template: text replaced, not duplicated.
    project = applyCommand(project, { type: 'applyThumbnail', template: THUMBNAIL_TEMPLATES[2]! })
    const after = findThumbnailTrack(project)!
    expect(after.id).toBe(track.id)
    expect(after.elements.filter((e) => e.type === 'text')).toHaveLength(1)
  })

  test('capture round-trips an applied cover', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'applyThumbnail', template: THUMBNAIL_TEMPLATES[0]! })
    const captured = captureThumbnailTemplate(project, 'Mine')!
    expect(captured.name).toBe('Mine')
    const texts = captured.items.filter((i) => i.kind === 'text')
    expect(texts.length).toBe(2)
    // Geometry survives the round trip (within rounding).
    const original = THUMBNAIL_TEMPLATES[0]!.items.find((i) => i.kind === 'text')!
    const roundTripped = texts[0]!
    expect(Math.abs(roundTripped.rect.x - original.rect.x)).toBeLessThan(0.02)
    expect(roundTripped.style.fontSize).toBe(original.style.fontSize)
  })

  test('capture returns null without a cover', () => {
    expect(captureThumbnailTemplate(createProject(), 'x')).toBeNull()
  })

  test('expand scales tracking, stroke, and shadow with the font', () => {
    // "Big title" headline ships stroke + shadow; its label ships tracking.
    const big = expandThumbnailTemplate(
      { width: 3840, height: 2160, fps: 30 },
      THUMBNAIL_TEMPLATES[0]!,
    ) as Array<Extract<ReturnType<typeof expandThumbnailTemplate>[number], { type: 'text' }>>
    const headlineTemplate = THUMBNAIL_TEMPLATES[0]!.items.find(
      (i) => i.kind === 'text' && i.style.stroke,
    ) as Extract<(typeof THUMBNAIL_TEMPLATES)[number]['items'][number], { kind: 'text' }>
    const headline = big.find((e) => e.style.stroke)!
    expect(headline.style.stroke!.width).toBeCloseTo(headlineTemplate.style.stroke!.width * 2, 5)
    expect(headline.style.shadow!.blur).toBeCloseTo(headlineTemplate.style.shadow!.blur * 2, 5)
    const label = big.find((e) => e.style.letterSpacing > 0)!
    expect(label.style.letterSpacing).toBeCloseTo(2 * 2, 5)
  })
})
