import { describe, expect, test } from 'bun:test'
import type { FaceSample } from '@mcut/editor'
import { EditorEngine, getElementLocation, parseProject, type Project } from '@mcut/timeline'
import { centerPerson } from './center-person'

const OPTIONS = { aspect: 9 / 16, smoothing: 0.5 }

const STILL_FACE: FaceSample[] = [
  { sourceMs: 0, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 } },
  { sourceMs: 1000, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 } },
]

const ASSETS = {
  'a-screen': { id: 'a-screen', kind: 'video', src: 'blob:screen', name: 'screen.mp4', durationMs: 8000, width: 1920, height: 1080 },
  'a-camera': { id: 'a-camera', kind: 'video', src: 'blob:camera', name: 'camera.mp4', durationMs: 8000, width: 1920, height: 1080 },
}

function videoProject(): Project {
  return parseProject({
    id: 'p-center-video',
    name: 'Center video',
    width: 1080,
    height: 1920,
    fps: 30,
    assets: ASSETS,
    tracks: [{ id: 't-video', name: 'Video', elements: [{ id: 'e-video', type: 'video', assetId: 'a-camera', startMs: 0, durationMs: 3000, trimStartMs: 0 }] }],
  })
}

function multicamProject(cameraKey: string): Project {
  return parseProject({
    id: 'p-center-multicam',
    name: 'Center multicam',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: ASSETS,
    layouts: [{ id: 'lay-head', name: 'Head', slots: [{ source: cameraKey, rect: { x: 0.7, y: 0.6, w: 0.25, h: 0.35 } }] }],
    tracks: [
      {
        id: 't-video',
        name: 'Video',
        elements: [
          {
            id: 'e-multicam',
            type: 'multicam',
            startMs: 0,
            durationMs: 4000,
            sources: [
              { key: 'screen', assetId: 'a-screen', trimStartMs: 0 },
              { key: cameraKey, assetId: 'a-camera', trimStartMs: 0 },
            ],
            angles: [{ atMs: 0, layoutId: 'lay-head' }],
            audioSource: cameraKey,
          },
        ],
      },
    ],
  })
}

function recordingDetector(samples: FaceSample[]) {
  const sources: string[] = []
  const detect = async (src: string) => {
    sources.push(src)
    return samples
  }
  return { sources, detect }
}

const refuseToDetect = async (): Promise<FaceSample[]> => {
  throw new Error('detection ran')
}

function multicamSource(engine: EditorEngine, key: string) {
  const element = getElementLocation(engine.project, 'e-multicam')?.element
  return element?.type === 'multicam' ? element.sources.find((source) => source.key === key) : undefined
}

describe('centerPerson', () => {
  test('a selected multicam follows its camera source in one undo step', async () => {
    const engine = new EditorEngine({ project: multicamProject('camera') })
    engine.select(['e-multicam'])
    const detector = recordingDetector(STILL_FACE)

    const result = await centerPerson(engine, OPTIONS, detector.detect)

    expect(detector.sources).toEqual(['blob:camera'])
    expect(result).toEqual({
      target: { elementId: 'e-multicam', source: 'camera', assetId: 'a-camera', assetName: 'camera.mp4' },
      samples: 2,
      keys: 2,
      sourceRange: { startMs: 0, endMs: 1000 },
      filled: false,
    })
    expect(multicamSource(engine, 'camera')?.reframe).toEqual([
      { sourceMs: 0, x: 0.5, y: 0.4 },
      { sourceMs: 1000, x: 0.5, y: 0.4 },
    ])
    expect(multicamSource(engine, 'screen')?.reframe).toBeUndefined()

    engine.undo()

    expect(multicamSource(engine, 'camera')?.reframe).toBeUndefined()
    expect(engine.canUndo()).toBe(false)
  })

  test('a multicam without a camera source follows its first video source', async () => {
    const engine = new EditorEngine({ project: multicamProject('face') })
    const detector = recordingDetector(STILL_FACE)

    const result = await centerPerson(engine, { elementId: 'e-multicam', ...OPTIONS }, detector.detect)

    expect(detector.sources).toEqual(['blob:screen'])
    expect(result.target).toEqual({ elementId: 'e-multicam', source: 'screen', assetId: 'a-screen', assetName: 'screen.mp4' })
  })

  test('a video at the project aspect gets a face-following crop and fills the frame in one undo step', async () => {
    const engine = new EditorEngine({ project: videoProject() })

    const result = await centerPerson(engine, { elementId: 'e-video', ...OPTIONS }, recordingDetector(STILL_FACE).detect)
    const video = () => {
      const element = getElementLocation(engine.project, 'e-video')?.element
      return element?.type === 'video' ? { crop: element.crop, reframe: element.reframe, transform: element.transform } : undefined
    }

    expect(result.target).toEqual({ elementId: 'e-video', assetId: 'a-camera', assetName: 'camera.mp4' })
    expect(result.filled).toBe(true)
    expect(video()).toEqual({
      crop: { x: 0.3418, y: 0, w: 0.3164, h: 1 },
      reframe: [
        { sourceMs: 0, x: 0.5, y: 0.5 },
        { sourceMs: 1000, x: 0.5, y: 0.5 },
      ],
      transform: { x: 0, y: 0, scaleX: 1.7778, scaleY: 1.7778, rotation: 0 },
    })

    engine.undo()

    expect(video()).toEqual({ crop: undefined, reframe: undefined, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } })
    expect(engine.canUndo()).toBe(false)
  })

  test('a source on a video clip fails before detection runs', async () => {
    const engine = new EditorEngine({ project: videoProject() })
    const before = engine.project

    await expect(centerPerson(engine, { elementId: 'e-video', source: 'camera', ...OPTIONS }, refuseToDetect)).rejects.toThrow(
      'source picks a multicam angle, and "e-video" is a video clip.',
    )
    expect(engine.project).toBe(before)
  })

  test('a clip with no face leaves the project untouched', async () => {
    const engine = new EditorEngine({ project: videoProject() })
    const before = engine.project

    await expect(centerPerson(engine, { elementId: 'e-video', ...OPTIONS }, recordingDetector([{ sourceMs: 0, box: null }]).detect)).rejects.toThrow(
      'no face in 1 samples',
    )
    expect(engine.project).toBe(before)
    expect(engine.canUndo()).toBe(false)
  })
})
