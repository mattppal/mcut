import { describe, expect, test } from 'bun:test'
import { createProject, parseProject } from './model'
import { migrateProject, ProjectFormatError, PROJECT_VERSION } from './migrations'
import { frameToMs, msToFrame, quantizeMsToFrame } from './time'

describe('project format versioning', () => {
  test('createProject stamps the current version', () => {
    expect(createProject().version).toBe(PROJECT_VERSION)
  })

  test('parseProject accepts pre-versioning documents (no version field)', () => {
    const { version: _version, ...legacy } = createProject({ name: 'old' })
    expect('version' in legacy).toBe(false)
    const parsed = parseProject(legacy)
    expect(parsed.version).toBe(PROJECT_VERSION)
    expect(parsed.name).toBe('old')
    expect(parsed.tracks[0]!.magnetic).toBe(false)
  })

  test('round-trips current documents unchanged', () => {
    const project = createProject({ name: 'now' })
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  })

  test('refuses documents from a newer mcut', () => {
    const doc = { ...createProject(), version: PROJECT_VERSION + 1 }
    expect(() => parseProject(doc)).toThrow(ProjectFormatError)
    try {
      parseProject(doc)
    } catch (error) {
      expect((error as ProjectFormatError).code).toBe('newer-version')
    }
  })

  test('rejects garbage version fields and non-object documents', () => {
    expect(() => migrateProject(null)).toThrow(ProjectFormatError)
    expect(() => migrateProject([])).toThrow(ProjectFormatError)
    expect(() => migrateProject({ version: 'two' })).toThrow(ProjectFormatError)
    expect(() => migrateProject({ version: 0 })).toThrow(ProjectFormatError)
  })
})

function v1Multicam(multicam: object): unknown {
  return {
    version: 1,
    id: 'p-v1',
    name: 'v1',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-screen': { id: 'a-screen', kind: 'video', src: 'blob:screen', durationMs: 60_000 },
      'a-camera': { id: 'a-camera', kind: 'video', src: 'blob:camera', durationMs: 60_000 },
    },
    tracks: [{ id: 't-1', name: 'Track 1', elements: [{ id: 'e-mc', type: 'multicam', startMs: 0, durationMs: 6000, ...multicam }] }],
  }
}

describe('v1 to v2 migration', () => {
  test('moves a multicam onto its group clock through the old time map', () => {
    const project = parseProject(
      v1Multicam({
        sources: [
          { key: 'screen', assetId: 'a-screen', trimStartMs: 1000 },
          { key: 'camera', assetId: 'a-camera', trimStartMs: 1600 },
        ],
        angles: [
          { atMs: 0, layoutId: 'l-screen' },
          { atMs: 2000, layoutId: 'l-camera' },
          { atMs: 5000, layoutId: 'l-screen' },
        ],
        timeMap: [
          { timeMs: 0, value: 0 },
          { timeMs: 6000, value: 12_000 },
        ],
      }),
    )
    expect(project.version).toBe(2)
    expect(project.tracks[0]?.elements[0]).toMatchObject({
      trimStartMs: 1000,
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-camera', offsetMs: 600 },
      ],
      angles: [
        { atMs: 1000, layoutId: 'l-screen' },
        { atMs: 5000, layoutId: 'l-camera' },
        { atMs: 11_000, layoutId: 'l-screen' },
      ],
    })
  })

  test('keeps cut spacing when the multicam has no time map', () => {
    const project = parseProject(
      v1Multicam({
        sources: [
          { key: 'screen', assetId: 'a-screen', trimStartMs: 500 },
          { key: 'camera', assetId: 'a-camera', trimStartMs: 300 },
        ],
        angles: [
          { atMs: 0, layoutId: 'l-screen' },
          { atMs: 2000, layoutId: 'l-camera' },
        ],
      }),
    )
    expect(project.tracks[0]?.elements[0]).toMatchObject({
      trimStartMs: 300,
      sources: [
        { key: 'screen', offsetMs: 200 },
        { key: 'camera', offsetMs: 0 },
      ],
      angles: [
        { atMs: 300, layoutId: 'l-screen' },
        { atMs: 2300, layoutId: 'l-camera' },
      ],
    })
  })
})

describe('frame quantization helpers', () => {
  test('frame boundaries round-trip', () => {
    for (const fps of [24, 30, 60]) {
      for (const frame of [0, 1, 29, 100]) {
        expect(msToFrame(frameToMs(frame, fps), fps)).toBe(frame)
      }
    }
  })

  test('quantizeMsToFrame snaps to the nearest boundary', () => {
    expect(quantizeMsToFrame(40, 30)).toBe(33)
    expect(quantizeMsToFrame(60, 30)).toBe(67)
    expect(quantizeMsToFrame(60, 30, 'floor')).toBe(33)
    expect(quantizeMsToFrame(34, 30, 'ceil')).toBe(67)
    expect(quantizeMsToFrame(quantizeMsToFrame(40, 30), 30)).toBe(33)
  })
})
