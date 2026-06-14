import { describe, expect, test } from 'bun:test'
import { EditorEngine, createProject, type Project } from '@mcut/timeline'
import { lintProject } from './lint'

function validProject(): Project {
  const engine = new EditorEngine({ project: createProject({ id: 'p-test' }) })
  engine.dispatch({
    type: 'addAsset',
    asset: { id: 'a-1', kind: 'video', src: 'media/a.mp4', name: 'a.mp4', durationMs: 60000 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-default',
    element: { id: 'e-1', type: 'video', startMs: 0, durationMs: 5000, assetId: 'a-1' },
  })
  return engine.project
}

const codes = (project: Project) => lintProject(project).map((issue) => issue.code)

describe('lintProject', () => {
  test('clean project has no issues', () => {
    expect(lintProject(validProject())).toEqual([])
  })

  test('flags missing assets as errors', () => {
    const project = validProject()
    const broken = { ...project, assets: {} }
    expect(codes(broken)).toContain('missing-asset')
  })

  test('flags overlapping elements', () => {
    const project = validProject()
    const track = project.tracks[0]!
    const clone = structuredClone(track.elements[0]!)
    clone.id = 'e-2' as typeof clone.id
    clone.startMs = 2500
    const broken = { ...project, tracks: [{ ...track, elements: [...track.elements, clone] }] }
    expect(codes(broken)).toContain('overlap')
  })

  test('warns on keyframes beyond the element duration', () => {
    const engine = new EditorEngine({ project: validProject() })
    engine.dispatch({ type: 'setKeyframe', elementId: 'e-1', property: 'opacity', timeMs: 1000, value: 1 })
    engine.dispatch({ type: 'setKeyframe', elementId: 'e-1', property: 'opacity', timeMs: 4000, value: 0 })
    engine.dispatch({ type: 'trimElement', elementId: 'e-1', durationMs: 2000 })
    expect(codes(engine.project)).toContain('keyframe-out-of-range')
  })

  test('warns on a transition without an adjacent neighbor', () => {
    const project = validProject()
    const track = project.tracks[0]!
    const element = { ...track.elements[0]!, transition: { type: 'dissolve', durationMs: 500 } }
    const broken = {
      ...project,
      tracks: [{ ...track, elements: [element] }],
    } as Project
    expect(codes(broken)).toContain('transition-without-neighbor')
  })

  test('flags multicam problems', () => {
    const engine = new EditorEngine({ project: validProject() })
    engine.dispatch({ type: 'createMulticam', elementIds: ['e-1'], multicamId: 'e-mc' })
    const project = engine.project
    const track = project.tracks.find((t) => t.elements.some((e) => e.id === 'e-mc'))!
    const multicam = structuredClone(track.elements.find((e) => e.id === 'e-mc')!)
    if (multicam.type !== 'multicam') throw new Error('expected multicam')
    multicam.angles = [{ atMs: 0, layoutId: 'l-nope' }]
    multicam.audioSource = 'ghost'
    const broken = {
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === track.id
          ? { ...t, elements: t.elements.map((e) => (e.id === 'e-mc' ? multicam : e)) }
          : t,
      ),
    }
    const found = codes(broken)
    expect(found).toContain('missing-layout')
    expect(found).toContain('missing-audio-source')
  })

  test('warns on empty projects and empty tracks', () => {
    const found = codes(createProject({ id: 'p-empty' }))
    expect(found).toContain('empty-track')
    expect(found).toContain('empty-project')
  })
})
