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

describe('frame quantization helpers', () => {
  test('frame boundaries round-trip', () => {
    for (const fps of [24, 30, 60]) {
      for (const frame of [0, 1, 29, 100]) {
        expect(msToFrame(frameToMs(frame, fps), fps)).toBe(frame)
      }
    }
  })

  test('quantizeMsToFrame snaps to the nearest boundary', () => {
    // 30fps: frames at 0, 33, 67, 100...
    expect(quantizeMsToFrame(40, 30)).toBe(33)
    expect(quantizeMsToFrame(60, 30)).toBe(67)
    expect(quantizeMsToFrame(60, 30, 'floor')).toBe(33)
    expect(quantizeMsToFrame(34, 30, 'ceil')).toBe(67)
    expect(quantizeMsToFrame(quantizeMsToFrame(40, 30), 30)).toBe(33)
  })
})
