import { describe, expect, test } from 'bun:test'
import {
  getProjectMediaContext,
  getProjectTranscript,
} from './project-context'
import { parseProject, type Project } from './model'

function projectWithTranscript(): Project {
  return parseProject({
    id: 'p-context',
    name: 'Context test',
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      'a-video': {
        id: 'a-video',
        kind: 'video',
        src: 'blob:video',
        name: 'talk.mp4',
        mimeType: 'video/mp4',
        durationMs: 12_000,
        width: 1920,
        height: 1080,
        hash: 'hash-video',
        nativePreview: true,
      },
    },
    tracks: [
      {
        id: 't-video',
        name: 'Video',
        elements: [
          {
            id: 'e-video',
            type: 'video',
            assetId: 'a-video',
            startMs: 1000,
            durationMs: 4000,
            trimStartMs: 2000,
          },
        ],
      },
      {
        id: 't-captions',
        name: 'Captions',
        elements: [
          {
            id: 'e-cap-1',
            type: 'caption',
            startMs: 1200,
            durationMs: 900,
            text: 'Hello world',
            words: [
              { text: 'Hello', startMs: 0, endMs: 300 },
              { text: 'world', startMs: 340, endMs: 700 },
            ],
          },
          {
            id: 'e-cap-2',
            type: 'caption',
            startMs: 2400,
            durationMs: 600,
            text: 'Edited caption',
          },
        ],
      },
    ],
    markers: [{ id: 'm-hook', timeMs: 1100, label: 'Hook' }],
  })
}

describe('getProjectTranscript', () => {
  test('extracts captions with absolute word timings', () => {
    const transcript = getProjectTranscript(projectWithTranscript(), { includeWords: true })

    expect(transcript.hasTranscript).toBe(true)
    expect(transcript.captionCount).toBe(2)
    expect(transcript.wordCount).toBe(2)
    expect(transcript.text).toBe('Hello world\nEdited caption')
    expect(transcript.captions[0]).toMatchObject({
      id: 'e-cap-1',
      trackId: 't-captions',
      startMs: 1200,
      endMs: 2100,
      hasWordTimings: true,
      wordCount: 2,
      words: [
        { text: 'Hello', startMs: 1200, endMs: 1500 },
        { text: 'world', startMs: 1540, endMs: 1900 },
      ],
    })
    expect(transcript.captions[1]).toMatchObject({
      id: 'e-cap-2',
      hasWordTimings: false,
      wordCount: 0,
      text: 'Edited caption',
    })
  })
})

describe('getProjectMediaContext', () => {
  test('reports assets, source ranges, selection, playback, and transcript availability', () => {
    const context = getProjectMediaContext(projectWithTranscript(), {
      playback: {
        currentTimeMs: 1500,
        isPlaying: false,
        playbackRate: 1,
        volume: 1,
        muted: false,
      },
      selection: { elementIds: ['e-video'] },
    })

    expect(context.project).toMatchObject({
      id: 'p-context',
      name: 'Context test',
      durationMs: 5000,
      trackCount: 2,
      assetCount: 1,
      markerCount: 1,
    })
    expect(context.selection.elementIds).toEqual(['e-video'])
    expect(context.assets[0]).toMatchObject({
      id: 'a-video',
      kind: 'video',
      name: 'talk.mp4',
      durationMs: 12_000,
      width: 1920,
      height: 1080,
      usedBy: ['e-video'],
    })
    expect(context.tracks[0]?.elements[0]).toMatchObject({
      id: 'e-video',
      type: 'video',
      selected: true,
      active: true,
      asset: { id: 'a-video', name: 'talk.mp4' },
      source: {
        startMs: 2000,
        endMs: 6000,
        durationMs: 4000,
        averageSpeed: 1,
        hasTimeMap: false,
        reversed: false,
      },
    })
    expect(context.transcript).toMatchObject({
      hasTranscript: true,
      captionCount: 2,
      wordCount: 2,
      startMs: 1200,
      endMs: 3000,
    })
  })
})
