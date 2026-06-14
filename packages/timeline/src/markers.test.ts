import { describe, expect, test } from 'bun:test'
import { applyCommand, CommandError } from './commands'
import { createProject, parseProject } from './model'

describe('marker commands', () => {
  test('addMarker keeps markers sorted by time', () => {
    let project = createProject({ name: 'markers' })
    project = applyCommand(project, { type: 'addMarker', id: 'm-b', timeMs: 5000 })
    project = applyCommand(project, { type: 'addMarker', id: 'm-a', timeMs: 1000, label: 'intro' })
    expect(project.markers.map((m) => m.id)).toEqual(['m-a', 'm-b'])
    expect(project.markers[0]!.label).toBe('intro')
  })

  test('addMarker generates ids and rejects duplicates', () => {
    let project = createProject({ name: 'markers' })
    project = applyCommand(project, { type: 'addMarker', timeMs: 0 })
    expect(project.markers[0]!.id).toMatch(/^m-/)
    expect(() =>
      applyCommand(project, { type: 'addMarker', id: project.markers[0]!.id, timeMs: 10 }),
    ).toThrow(CommandError)
  })

  test('updateMarker retimes (re-sorting) and clears label with null', () => {
    let project = createProject({ name: 'markers' })
    project = applyCommand(project, { type: 'addMarker', id: 'm-a', timeMs: 1000, label: 'x' })
    project = applyCommand(project, { type: 'addMarker', id: 'm-b', timeMs: 2000 })
    project = applyCommand(project, { type: 'updateMarker', markerId: 'm-a', timeMs: 3000, label: null })
    expect(project.markers.map((m) => m.id)).toEqual(['m-b', 'm-a'])
    expect(project.markers[1]!.label).toBeUndefined()
  })

  test('removeMarker removes; unknown ids throw', () => {
    let project = createProject({ name: 'markers' })
    project = applyCommand(project, { type: 'addMarker', id: 'm-a', timeMs: 0 })
    project = applyCommand(project, { type: 'removeMarker', markerId: 'm-a' })
    expect(project.markers).toHaveLength(0)
    expect(() => applyCommand(project, { type: 'removeMarker', markerId: 'm-a' })).toThrow(
      /no marker/,
    )
  })

  test('markers round-trip through serialization; old documents load', () => {
    let project = createProject({ name: 'markers' })
    project = applyCommand(project, { type: 'addMarker', id: 'm-a', timeMs: 1500, color: '#f00' })
    const reloaded = parseProject(JSON.parse(JSON.stringify(project)))
    expect(reloaded.markers).toEqual(project.markers)

    // A pre-markers document (no `markers` key) parses with an empty list.
    const { markers: _markers, ...legacy } = JSON.parse(JSON.stringify(project))
    expect(parseProject(legacy).markers).toEqual([])
  })
})
