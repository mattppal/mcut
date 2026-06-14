import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, parseProject } from './model'
import { listPresets, type PropertyPreset } from './presets'

const preset = (overrides: Partial<PropertyPreset> = {}): PropertyPreset => ({
  id: 'ps-1',
  name: 'Soft PiP',
  kind: 'slot-style',
  values: { cornerRadius: 0.12, shadow: true, fit: 'cover' },
  ...overrides,
})

describe('preset commands', () => {
  test('savePreset appends a new preset', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'savePreset', preset: preset() })
    expect(project.presets).toHaveLength(1)
    expect(project.presets[0]).toMatchObject({ name: 'Soft PiP', kind: 'slot-style' })
  })

  test('savePreset replaces an existing preset by id', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'savePreset', preset: preset() })
    project = applyCommand(project, {
      type: 'savePreset',
      preset: preset({ name: 'Hard PiP', values: { cornerRadius: 0 } }),
    })
    expect(project.presets).toHaveLength(1)
    expect(project.presets[0]).toMatchObject({ name: 'Hard PiP', values: { cornerRadius: 0 } })
  })

  test('removePreset drops the preset and rejects unknown ids', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'savePreset', preset: preset() })
    project = applyCommand(project, { type: 'removePreset', presetId: 'ps-1' })
    expect(project.presets).toHaveLength(0)
    expect(() => applyCommand(project, { type: 'removePreset', presetId: 'ps-1' })).toThrow(
      CommandError,
    )
  })

  test('listPresets filters by kind in saved order', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'savePreset', preset: preset() })
    project = applyCommand(project, {
      type: 'savePreset',
      preset: preset({ id: 'ps-2', kind: 'effects', name: 'Dreamy' }),
    })
    project = applyCommand(project, {
      type: 'savePreset',
      preset: preset({ id: 'ps-3', name: 'Square PiP' }),
    })
    expect(listPresets(project, 'slot-style').map((p) => p.id)).toEqual(['ps-1', 'ps-3'])
    expect(listPresets(project, 'effects').map((p) => p.id)).toEqual(['ps-2'])
  })

  test('projects without presets parse with an empty list', () => {
    const project = createProject()
    const doc = JSON.parse(JSON.stringify(project)) as Record<string, unknown>
    delete doc.presets
    expect(parseProject(doc).presets).toEqual([])
  })

  test('presets round-trip through serialization', () => {
    let project = createProject()
    project = applyCommand(project, { type: 'savePreset', preset: preset() })
    const restored = parseProject(JSON.parse(JSON.stringify(project)))
    expect(restored.presets).toEqual(project.presets)
  })
})
