import { describe, expect, test } from 'bun:test'
import { EditorEngine, getElementLocation, parseProject, type LayoutSlot, type MulticamElement } from '@mcut/timeline'
import { multicamSourcesInSelection, panSlotWindow, slotCoverWindow, switchToLayout } from './multicam-ui'

const slot: LayoutSlot = { source: 'camera', rect: { x: 0, y: 0, w: 0.5625, h: 1 }, fit: 'cover' }
const box = { width: 1080, height: 1080 }
const source = { width: 1920, height: 1080 }

describe('slot crop panning', () => {
  test('a cover slot shows the centered window of a wider source', () => {
    expect(slotCoverWindow(slot, box, source)).toEqual({ x: 0.21875, y: 0, w: 0.5625, h: 1 })
  })

  test('panning past the edge stops at the edge and the crop keeps showing it', () => {
    const crop = panSlotWindow(slotCoverWindow(slot, box, source), 0.9, 0.3)
    expect(crop).toEqual({ x: 0.4375, y: 0, w: 0.5625, h: 1 })
    expect(slotCoverWindow({ ...slot, crop }, box, source)).toEqual({ x: 0.4375, y: 0, w: 0.5625, h: 1 })
  })

  test('a window over the whole source stores no crop', () => {
    expect(panSlotWindow({ x: 0, y: 0, w: 1, h: 1 }, 0.2, 0.2)).toBeUndefined()
  })
})

function multicamEngine(): EditorEngine {
  const video = (id: string) => ({ id, kind: 'video', src: `blob:${id}`, name: `${id}.mp4`, durationMs: 8000, width: 1920, height: 1080 })
  const fullFrame = (source: string) => [{ source, rect: { x: 0, y: 0, w: 1, h: 1 } }]
  return new EditorEngine({
    project: parseProject({
      version: 2,
      id: 'p-multicam-ui',
      name: 'Multicam UI',
      width: 1920,
      height: 1080,
      fps: 30,
      assets: {
        'a-screen': video('a-screen'),
        'a-camera': video('a-camera'),
        'a-mic': { id: 'a-mic', kind: 'audio', src: 'blob:a-mic', name: 'mic.wav', durationMs: 8000 },
      },
      layouts: [
        { id: 'lay-camera', name: 'Camera', slots: fullFrame('camera') },
        { id: 'lay-screen', name: 'Screen', slots: fullFrame('screen') },
      ],
      tracks: [
        {
          id: 't-multicam',
          name: 'Multicam',
          elements: [
            {
              id: 'e-multicam',
              type: 'multicam',
              startMs: 2000,
              durationMs: 4000,
              trimStartMs: 1000,
              sources: [
                { key: 'screen', assetId: 'a-screen' },
                { key: 'camera', assetId: 'a-camera' },
              ],
              angles: [{ atMs: 1000, layoutId: 'lay-camera' }],
            },
          ],
        },
        {
          id: 't-clips',
          name: 'Clips',
          elements: [
            { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 7000, durationMs: 1000 },
            { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 8000, durationMs: 1000 },
            { id: 'e-title', type: 'text', startMs: 9000, durationMs: 1000, text: 'Title' },
          ],
        },
      ],
    }),
  })
}

function multicam(engine: EditorEngine): MulticamElement {
  const element = getElementLocation(engine.project, 'e-multicam')?.element
  if (element?.type !== 'multicam') throw new Error('e-multicam is not a multicam')
  return element
}

describe('switching a multicam layout', () => {
  test('cuts at the playhead on the group clock while playing and corrects the open span while paused', () => {
    const engine = multicamEngine()
    engine.seek(2500)
    engine.play()
    switchToLayout(engine, multicam(engine), 'lay-screen')
    expect(multicam(engine).angles).toEqual([
      { atMs: 1000, layoutId: 'lay-camera' },
      { atMs: 1500, layoutId: 'lay-screen' },
    ])

    engine.pause()
    engine.seek(2200)
    switchToLayout(engine, multicam(engine), 'lay-screen')
    expect(multicam(engine).angles).toEqual([
      { atMs: 1000, layoutId: 'lay-screen' },
      { atMs: 1500, layoutId: 'lay-screen' },
    ])
  })

  test('selected video and audio clips become multicam sources and other clips stay out', () => {
    const engine = multicamEngine()
    expect(multicamSourcesInSelection(engine.project, ['e-title', 'e-screen', 'e-mic', 'e-gone'])).toEqual([{ elementId: 'e-screen' }, { elementId: 'e-mic' }])
  })
})
