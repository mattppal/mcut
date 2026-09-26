import { describe, expect, test } from 'bun:test'
import { applyCommand, type CommandOfType } from './commands'
import { describeLayoutChange } from './layout-summary'
import { createProject, type Project } from './model'

const full = { x: 0, y: 0, w: 1, h: 1 }
const camera = { x: 0.7, y: 0.69, w: 0.275, h: 0.275 }
const shadow = { color: 'rgba(0, 0, 0, 0.45)', blur: 36, offsetX: 0, offsetY: 12 }

const save = (project: Project, slots: CommandOfType<'saveLayout'>['layout']['slots']) =>
  applyCommand(project, { type: 'saveLayout', layout: { id: 'l-pip', name: 'PiP', slots } })

const styledPip = () =>
  save(createProject({ width: 1920, height: 1080 }), [
    { source: 'screen', rect: full },
    { source: 'camera', rect: camera, cornerRadius: 0.12, shadow },
  ])

const slotsOf = (project: Project) => project.layouts[0]?.slots

describe('saveLayout', () => {
  test('an overlay re-saved with only a new rect keeps its corner radius and shadow', () => {
    const before = styledPip()
    const after = save(before, [{ source: 'screen' }, { source: 'camera', rect: { x: 0.6, y: 0.59, w: 0.375, h: 0.375 } }])

    expect(slotsOf(after)).toStrictEqual([
      { source: 'screen', rect: full, fit: 'cover' },
      { source: 'camera', rect: { x: 0.6, y: 0.59, w: 0.375, h: 0.375 }, fit: 'cover', cornerRadius: 0.12, shadow },
    ])
    expect(describeLayoutChange(before, after, 'l-pip')).toEqual([
      'Layout "PiP" (picture-in-picture), before → after:',
      '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)',
      '  camera overlay bottom-right 528×297 px, aspect 1.78 (16:9) → camera overlay bottom-right 720×405 px, aspect 1.78 (16:9) (width +36%, height +36%)',
    ])
  })

  test('null clears one field and leaves the rest', () => {
    const after = save(styledPip(), [{ source: 'screen' }, { source: 'camera', shadow: null }])

    expect(slotsOf(after)?.[1]).toStrictEqual({ source: 'camera', rect: camera, fit: 'cover', cornerRadius: 0.12 })
  })

  test('a source left out of the list is removed', () => {
    expect(slotsOf(save(styledPip(), [{ source: 'screen' }]))).toStrictEqual([{ source: 'screen', rect: full, fit: 'cover' }])
  })

  test('a source new to the layout needs a rect', () => {
    expect(() => save(styledPip(), [{ source: 'screen' }, { source: 'cam-2' }])).toThrow('slot "cam-2" is new to layout "PiP", so it needs a rect')
  })
})

describe('describeLayoutChange styling', () => {
  const header = 'Layout "PiP" (picture-in-picture), before → after:'
  const screen = '  screen full-frame 1920×1080 px, aspect 1.78 (16:9) (unchanged)'

  test('a null shadow shows as removed and warns how to restore it', () => {
    const before = styledPip()
    const after = save(before, [{ source: 'screen' }, { source: 'camera', shadow: null }])

    expect(describeLayoutChange(before, after, 'l-pip')).toEqual([
      header,
      screen,
      '  camera overlay bottom-right 528×297 px, aspect 1.78 (16:9) (shadow removed)',
      'Warning: the camera overlay lost its shadow. To restore it, save this layout with ' +
        '{"source":"camera","shadow":{"color":"rgba(0, 0, 0, 0.45)","blur":36,"offsetX":0,"offsetY":12}} as the camera slot.',
    ])
  })

  test('each style change is listed next to a resize, and a lost corner radius warns', () => {
    const before = styledPip()
    const after = save(before, [
      { source: 'screen' },
      {
        source: 'camera',
        rect: { x: 0.6, y: 0.59, w: 0.375, h: 0.375 },
        cornerRadius: 0,
        stroke: { width: 2, color: '#ffffff' },
        shadow: { ...shadow, blur: 48 },
      },
    ])

    expect(describeLayoutChange(before, after, 'l-pip')).toEqual([
      header,
      screen,
      '  camera overlay bottom-right 528×297 px, aspect 1.78 (16:9) → camera overlay bottom-right 720×405 px, aspect 1.78 (16:9) ' +
        '(width +36%, height +36%, corner radius 0.12 → 0, stroke added (2 px #ffffff), shadow blur 36 → 48)',
      'Warning: the camera overlay lost its corner radius. To restore it, save this layout with {"source":"camera","cornerRadius":0.12} as the camera slot.',
    ])
  })

  test('a restyle in place names the fields instead of a bare restyled', () => {
    const before = styledPip()
    const after = save(before, [{ source: 'screen' }, { source: 'camera', fit: 'contain', crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, cornerRadius: 0.2 }])

    expect(describeLayoutChange(before, after, 'l-pip').at(-1)).toBe(
      '  camera overlay bottom-right 528×297 px, aspect 1.78 (16:9) (fit cover → contain, crop added (x 0.25, y 0, w 0.5, h 1), corner radius 0.12 → 0.2)',
    )
  })
})

describe('saveLayout overlay defaults', () => {
  const bottomLeft = { x: 0.025, y: 0.69, w: 0.275, h: 0.275 }

  test('a new overlay that sets no corner radius, stroke, or shadow gets the picture-in-picture look, crop or not', () => {
    const crop = { x: 0.25, y: 0, w: 0.5, h: 1 }
    const project = save(createProject({ width: 1920, height: 1080 }), [
      { source: 'screen', rect: full },
      { source: 'camera', rect: camera },
      { source: 'cam-2', rect: bottomLeft, crop },
    ])

    expect(slotsOf(project)).toStrictEqual([
      { source: 'screen', rect: full, fit: 'cover' },
      { source: 'camera', rect: camera, fit: 'cover', cornerRadius: 0.12, shadow },
      { source: 'cam-2', rect: bottomLeft, fit: 'cover', crop, cornerRadius: 0.12, shadow },
    ])
  })

  test('a new overlay that sets any of them, even to null, keeps only what it set', () => {
    const topLeft = { x: 0.025, y: 0.05, w: 0.2, h: 0.2 }
    const topRight = { x: 0.775, y: 0.05, w: 0.2, h: 0.2 }
    const project = save(styledPip(), [
      { source: 'screen' },
      { source: 'camera' },
      { source: 'cam-2', rect: topLeft, shadow: null },
      { source: 'cam-3', rect: topRight, stroke: { width: 2, color: '#ffffff' } },
    ])

    expect(slotsOf(project)?.slice(2)).toStrictEqual([
      { source: 'cam-2', rect: topLeft, fit: 'cover' },
      { source: 'cam-3', rect: topRight, fit: 'cover', stroke: { color: '#ffffff', width: 2 } },
    ])
  })

  test('an overlay already in the layout stays unstyled when re-saved', () => {
    const flat = save(createProject({ width: 1920, height: 1080 }), [
      { source: 'screen', rect: full },
      { source: 'camera', rect: camera, shadow: null },
    ])
    const after = save(flat, [{ source: 'screen' }, { source: 'camera', rect: bottomLeft }])

    expect(slotsOf(after)?.[1]).toStrictEqual({ source: 'camera', rect: bottomLeft, fit: 'cover' })
  })
})
