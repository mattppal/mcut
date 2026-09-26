import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type Project } from '@mcut/timeline'
import { getActiveMediaItems } from './preview-pool'

describe('getActiveMediaItems', () => {
  function multicamProject(): Project {
    let project = createProject()
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:m', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-room', kind: 'audio', src: 'blob:r', durationMs: 60_000 } })
    return applyCommand(project, {
      type: 'addElement',
      trackId: 't-default',
      element: {
        type: 'multicam',
        id: 'e-mc',
        startMs: 0,
        durationMs: 5000,
        trimStartMs: 1000,
        volume: 0.8,
        sources: [
          { key: 'camera', assetId: 'a-cam' },
          { key: 'screen', assetId: 'a-screen', offsetMs: 1500 },
          { key: 'mic', assetId: 'a-mic', offsetMs: 200 },
          { key: 'room', assetId: 'a-room' },
        ],
        angles: [{ atMs: 0, layoutId: 'l-any' }],
        audioSource: 'mic',
      },
    })
  }

  test('feeds every camera of a multicam on its offset and no audio source', () => {
    expect(getActiveMediaItems(multicamProject(), 500)).toEqual([
      { assetId: 'a-cam', sourceTimeMs: 1500, rate: 1 },
      { assetId: 'a-screen', sourceTimeMs: 3000, rate: 1 },
    ])
  })

  test('a sped up multicam plays at its speed and a reversed one says so', () => {
    const fast = applyCommand(multicamProject(), { type: 'setElementSpeed', elementId: 'e-mc', speed: 2 })
    expect(getActiveMediaItems(fast, 500)[0]).toEqual({ assetId: 'a-cam', sourceTimeMs: 2000, rate: 2 })

    const reversed = applyCommand(multicamProject(), { type: 'updateElement', elementId: 'e-mc', patch: { reversed: true } })
    expect(getActiveMediaItems(reversed, 500)[0]).toEqual({ assetId: 'a-cam', sourceTimeMs: 5500, rate: 1, reversed: true })
  })

  test('a hidden track feeds no pictures and an audio clip feeds none', () => {
    const hidden = applyCommand(multicamProject(), { type: 'setTrackFlags', trackId: 't-default', hidden: true })
    expect(getActiveMediaItems(hidden, 500)).toEqual([])

    const audioOnly = applyCommand(multicamProject(), {
      type: 'addElement',
      trackId: 't-default',
      element: { type: 'audio', id: 'e-aud', assetId: 'a-mic', startMs: 6000, durationMs: 1000 },
    })
    expect(getActiveMediaItems(audioOnly, 6500)).toEqual([])
  })
})
