import { describe, expect, test } from 'bun:test'
import { parseProject, type Project } from './model'
import { makeConstantSpeedMap } from './speed'
import { resolveElementAudioSource } from './audio-source'

function project(): Project {
  return parseProject({
    id: 'p-audio-source',
    name: 'Audio source',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-video': {
        id: 'a-video',
        kind: 'video',
        src: 'blob:video',
        durationMs: 10_000,
      },
      'a-audio': {
        id: 'a-audio',
        kind: 'audio',
        src: 'blob:audio',
        durationMs: 12_000,
      },
      'a-screen': {
        id: 'a-screen',
        kind: 'video',
        src: 'blob:screen',
        durationMs: 20_000,
      },
      'a-camera': {
        id: 'a-camera',
        kind: 'video',
        src: 'blob:camera',
        durationMs: 20_000,
      },
    },
    layouts: [
      {
        id: 'lay-camera',
        name: 'Camera',
        slots: [{ source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    ],
    tracks: [
      {
        id: 't-main',
        name: 'Main',
        elements: [
          {
            id: 'e-video',
            type: 'video',
            assetId: 'a-video',
            startMs: 1000,
            durationMs: 3000,
            trimStartMs: 2000,
            reversed: true,
          },
          {
            id: 'e-audio',
            type: 'audio',
            assetId: 'a-audio',
            startMs: 5000,
            durationMs: 2000,
            trimStartMs: 4000,
            timeMap: makeConstantSpeedMap(2000, 2),
          },
          {
            id: 'e-multicam',
            type: 'multicam',
            startMs: 8000,
            durationMs: 4000,
            sources: [
              { key: 'screen', assetId: 'a-screen', trimStartMs: 100 },
              { key: 'camera', assetId: 'a-camera', trimStartMs: 600 },
            ],
            angles: [{ atMs: 0, layoutId: 'lay-camera' }],
            audioSource: 'camera',
          },
          {
            id: 'e-muted-multicam',
            type: 'multicam',
            startMs: 13_000,
            durationMs: 4000,
            sources: [{ key: 'camera', assetId: 'a-camera', trimStartMs: 1000 }],
            angles: [{ atMs: 0, layoutId: 'lay-camera' }],
          },
        ],
      },
    ],
  })
}

describe('resolveElementAudioSource', () => {
  test('resolves video source timing', () => {
    expect(resolveElementAudioSource(project(), 'e-video')).toMatchObject({
      elementId: 'e-video',
      elementType: 'video',
      assetId: 'a-video',
      timelineStartMs: 1000,
      timelineDurationMs: 3000,
      sourceStartMs: 2000,
      sourceEndMs: 5000,
      sourceSpanMs: 3000,
      reversed: true,
    })
  })

  test('resolves audio source timing with time maps', () => {
    const source = resolveElementAudioSource(project(), 'e-audio')

    expect(source).toMatchObject({
      elementId: 'e-audio',
      elementType: 'audio',
      assetId: 'a-audio',
      timelineStartMs: 5000,
      sourceStartMs: 4000,
      sourceEndMs: 8000,
      sourceSpanMs: 4000,
      reversed: false,
    })
    expect(source?.timeMap).toHaveLength(2)
  })

  test('resolves multicam pinned audio source', () => {
    expect(resolveElementAudioSource(project(), 'e-multicam')).toMatchObject({
      elementId: 'e-multicam',
      elementType: 'multicam',
      assetId: 'a-camera',
      timelineStartMs: 8000,
      timelineDurationMs: 4000,
      sourceStartMs: 600,
      sourceEndMs: 4600,
      sourceSpanMs: 4000,
      reversed: false,
      multicamSourceKey: 'camera',
    })
  })

  test('returns null for elements without playable source audio', () => {
    expect(resolveElementAudioSource(project(), 'e-muted-multicam')).toBeNull()
    expect(resolveElementAudioSource(project(), 'e-missing')).toBeNull()
  })
})
