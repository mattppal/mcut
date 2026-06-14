import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project, type TextRun } from '@mcut/timeline'
import { renderFrame } from './render-frame'
import { layoutTextBlock } from './text'
import { FakeContext2D } from './test-utils'
import type { Canvas2D } from './types'

/** Deterministic measure: 10px/char normal, 20px/char for bold (700) fonts. */
const measure = (text: string, font: string) =>
  text.length * (font.includes('700') ? 20 : 10)

const style = {
  fontFamily: 'sans-serif',
  fontSize: 64,
  fontWeight: 400,
  fontStyle: 'normal' as const,
  color: '#ffffff',
  align: 'center' as const,
  letterSpacing: 0,
  lineHeight: 1.25,
  textTransform: 'none' as const,
}

describe('layoutTextBlock with runs', () => {
  test('slices a line into measured segments at run boundaries', () => {
    const runs: TextRun[] = [{ start: 6, end: 11, style: { fontWeight: 700, color: '#f00' } }]
    const layout = layoutTextBlock(measure, 'hello world!', style, { runs })
    expect(layout.lines).toHaveLength(1)
    const segments = layout.lines[0]!.segments!
    expect(segments.map((s) => s.text)).toEqual(['hello ', 'world', '!'])
    expect(segments[1]).toMatchObject({ width: 100, color: '#f00' }) // 5 chars × 20
    expect(segments[0]!.width).toBe(60)
    expect(layout.lines[0]!.width).toBe(60 + 100 + 10)
  })

  test('bold segments affect wrapping inside a box', () => {
    // "aaa bbb" — bold doubles bbb's width so it no longer fits beside aaa.
    const runs: TextRun[] = [{ start: 4, end: 7, style: { fontWeight: 700 } }]
    const plain = layoutTextBlock(measure, 'aaa bbb', style, { box: { width: 90, overflow: 'clip' } })
    expect(plain.lines).toHaveLength(1) // 7 chars × 10 = 70 ≤ 90
    const rich = layoutTextBlock(measure, 'aaa bbb', style, {
      box: { width: 90, overflow: 'clip' },
      runs,
    })
    expect(rich.lines).toHaveLength(2) // "aaa " 40 + bold "bbb" 60 = 100 > 90
    expect(rich.lines.map((l) => l.text)).toEqual(['aaa', 'bbb'])
  })

  test('case transform applies per segment without breaking offsets', () => {
    const runs: TextRun[] = [{ start: 0, end: 2, style: { color: '#0f0' } }]
    const layout = layoutTextBlock(measure, 'ab cd', { ...style, textTransform: 'uppercase' }, { runs })
    expect(layout.lines[0]!.segments!.map((s) => s.text)).toEqual(['AB', ' CD'])
  })

  test('no runs keeps the legacy line shape (no segments)', () => {
    const layout = layoutTextBlock(measure, 'plain', style, {})
    expect(layout.lines[0]!.segments).toBeUndefined()
  })
})

function projectWithText(): Project {
  let project = createProject()
  return applyCommand(project, {
    type: 'addElement',
    trackId: project.tracks[0]!.id,
    element: {
      type: 'text',
      id: 'e-t',
      text: 'Title',
      style,
      startMs: 0,
      durationMs: 3000,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      opacity: 1,
    },
  })
}

describe('skipElementIds', () => {
  test('a skipped element paints nothing', () => {
    const project = projectWithText()
    const drawn = new FakeContext2D()
    renderFrame(drawn as unknown as Canvas2D, project, 1000, {})
    expect(drawn.callsTo('fillText').length).toBeGreaterThan(0)

    const skipped = new FakeContext2D()
    renderFrame(skipped as unknown as Canvas2D, project, 1000, {
      skipElementIds: new Set(['e-t']),
    })
    expect(skipped.callsTo('fillText')).toHaveLength(0)
  })
})

describe('runs render with per-segment fill', () => {
  test('each segment paints with its own color', () => {
    let project = projectWithText()
    project = applyCommand(project, {
      type: 'updateElement',
      elementId: 'e-t',
      patch: { runs: [{ start: 0, end: 2, style: { color: '#ff0000' } }] },
    })
    const ctx = new FakeContext2D()
    renderFrame(ctx as unknown as Canvas2D, project, 1000, {})
    const fills = ctx.callsTo('fillText')
    expect(fills).toHaveLength(2) // "Ti" + "tle"
    expect(fills[0]!.fillStyle).toBe('#ff0000')
    expect(fills[1]!.fillStyle).toBe('#ffffff')
  })
})
