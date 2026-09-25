import { describe, expect, test } from 'bun:test'
import { collectClipDragBases } from '@mcut/editor'
import { parseProject } from '@mcut/timeline'
import { planClipDrag } from './timeline-drag-plan'

const project = parseProject({
  version: 2,
  id: 'p-drag-plan',
  name: 'Drag plan',
  width: 1920,
  height: 1080,
  fps: 30,
  assets: {
    'a-screen': { id: 'a-screen', kind: 'video', src: 'blob:screen', name: 'screen.mp4', durationMs: 8000, width: 1920, height: 1080 },
    'a-camera': { id: 'a-camera', kind: 'video', src: 'blob:camera', name: 'camera.mp4', durationMs: 6000, width: 1920, height: 1080 },
  },
  layouts: [{ id: 'lay-camera', name: 'Camera', slots: [{ source: 'camera', rect: { x: 0, y: 0, w: 1, h: 1 } }] }],
  tracks: [
    {
      id: 't-video',
      name: 'Video',
      elements: [
        {
          id: 'e-multicam',
          type: 'multicam',
          startMs: 0,
          durationMs: 2000,
          trimStartMs: 1000,
          sources: [
            { key: 'screen', assetId: 'a-screen' },
            { key: 'camera', assetId: 'a-camera', offsetMs: 2000 },
          ],
          angles: [{ atMs: 1000, layoutId: 'lay-camera' }],
        },
      ],
    },
  ],
})

describe('trim drag on a multicam', () => {
  test('the end edge stops where the source that runs out first ends', () => {
    const plan = planClipDrag({
      project,
      mode: 'trim-end',
      ids: ['e-multicam'],
      bases: collectClipDragBases(project, ['e-multicam']),
      ignore: new Set(['e-multicam']),
      targets: [],
      deltaRawMs: 5000,
      snapping: false,
      thresholdMs: 0,
      pointerRow: null,
      newTrackId: null,
    })
    expect(plan.commands).toEqual([{ type: 'trimEdge', elementId: 'e-multicam', edge: 'end', deltaMs: 1000 }])
    expect(plan.previews).toEqual([{ id: 'e-multicam', startMs: 0, durationMs: 3000, row: 0 }])
  })
})
