import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type ElementId, type Project } from '@mcut/timeline'
import { coalesceActiveMediaItems, getActiveMediaItems, type ActiveMediaItem } from './preview-pool'

const base: ActiveMediaItem = {
  assetId: 'a-1',
  kind: 'video',
  sourceTimeMs: 1000,
  rate: 1,
  volume: 0,
}

describe('coalesceActiveMediaItems', () => {
  test('keeps an audible item from being overwritten by a muted visual item', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', sourceTimeMs: 5000, volume: 0 },
      { ...base, kind: 'audio', sourceTimeMs: 1000, volume: 0.8 },
    ])

    expect(items).toEqual([{ ...base, kind: 'video', sourceTimeMs: 1000, rate: 1, volume: 0.8 }])
  })

  test('keeps video capability when an audio item is the audible source', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'audio', sourceTimeMs: 1000, volume: 0.5 },
      { ...base, kind: 'video', sourceTimeMs: 1000, volume: 0 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 1000, volume: 0.5 })
  })

  test('combines volume for duplicate audible items on the same media clock', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', volume: 0.4 },
      { ...base, kind: 'audio', sourceTimeMs: 1020, volume: 0.3 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 1000, volume: 0.7 })
  })

  test('uses the louder item when duplicate audible items need different clocks', () => {
    const items = coalesceActiveMediaItems([
      { ...base, kind: 'video', sourceTimeMs: 1000, volume: 0.4 },
      { ...base, kind: 'audio', sourceTimeMs: 3000, volume: 0.9 },
    ])

    expect(items[0]).toMatchObject({ kind: 'video', sourceTimeMs: 3000, volume: 0.9 })
  })

  test('keeps items with different replacement audio apart', () => {
    const items = coalesceActiveMediaItems([
      { ...base, audioSrc: 'blob:wet-a', volume: 0.4 },
      { ...base, audioSrc: 'blob:wet-b', volume: 0.9 },
    ])

    expect(items).toHaveLength(2)
    expect(items.map((item) => item.audioSrc).sort()).toEqual(['blob:wet-a', 'blob:wet-b'])
  })

  test('combines volume when replacement audio matches', () => {
    const items = coalesceActiveMediaItems([
      { ...base, audioSrc: 'blob:wet', volume: 0.4 },
      { ...base, audioSrc: 'blob:wet', sourceTimeMs: 1020, volume: 0.3 },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ volume: 0.7, audioSrc: 'blob:wet' })
  })
})

describe('getActiveMediaItems', () => {
  test('fills audioSrc from the element map', () => {
    let project = createProject()
    const track = project.tracks[0]
    if (!track) throw new Error('missing track')
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000 },
    })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-aud', kind: 'audio', src: 'blob:audio', durationMs: 10_000 },
    })
    project = applyCommand(project, {
      type: 'addAsset',
      asset: { id: 'a-cam', kind: 'video', src: 'blob:cam', durationMs: 10_000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: track.id,
      element: { type: 'video', id: 'e-vid', assetId: 'a-vid', startMs: 0, durationMs: 2000 },
    })
    project = applyCommand(project, { type: 'addTrack' })
    const audioTrack = project.tracks[1]
    if (!audioTrack) throw new Error('missing audio track')
    project = applyCommand(project, {
      type: 'addElement',
      trackId: audioTrack.id,
      element: { type: 'audio', id: 'e-aud', assetId: 'a-aud', startMs: 0, durationMs: 2000 },
    })
    project = applyCommand(project, { type: 'addTrack' })
    const multicamTrack = project.tracks[2]
    if (!multicamTrack) throw new Error('missing multicam track')
    project = applyCommand(project, {
      type: 'addElement',
      trackId: multicamTrack.id,
      element: {
        type: 'multicam',
        id: 'e-mc',
        startMs: 0,
        durationMs: 2000,
        sources: [
          { key: 'screen', assetId: 'a-vid' },
          { key: 'camera', assetId: 'a-cam' },
        ],
        angles: [{ atMs: 0, layoutId: 'lay-1' }],
        audioSource: 'camera',
      },
    })

    const audioSources = new Map<ElementId, string>([
      ['e-vid', 'blob:vid-wet'],
      ['e-mc', 'blob:mc-wet'],
    ])
    const plain = getActiveMediaItems(project, 500)
    expect(plain.every((item) => item.audioSrc === undefined)).toBe(true)

    const items = getActiveMediaItems(project, 500, audioSources)
    expect(items.find((item) => item.audioSrc === 'blob:vid-wet')?.assetId).toBe('a-vid')
    expect(items.find((item) => item.kind === 'audio')?.audioSrc).toBeUndefined()
    expect(
      items
        .filter((item) => item.audioSrc === 'blob:mc-wet')
        .map((item) => item.assetId)
        .sort(),
    ).toEqual(['a-cam'])
  })

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

  test('feeds every camera of a multicam on its offset and only the audio source is heard', () => {
    expect(getActiveMediaItems(multicamProject(), 500)).toEqual([
      { assetId: 'a-cam', kind: 'video', sourceTimeMs: 1500, rate: 1, volume: 0 },
      { assetId: 'a-screen', kind: 'video', sourceTimeMs: 3000, rate: 1, volume: 0 },
      { assetId: 'a-mic', kind: 'audio', sourceTimeMs: 1700, rate: 1, volume: 0.8 },
    ])
  })

  test('a sped up multicam plays at its speed and a reversed one is silent', () => {
    const fast = applyCommand(multicamProject(), { type: 'setElementSpeed', elementId: 'e-mc', speed: 2 })
    expect(getActiveMediaItems(fast, 500).find((item) => item.assetId === 'a-mic')).toEqual({
      assetId: 'a-mic',
      kind: 'audio',
      sourceTimeMs: 2200,
      rate: 2,
      volume: 0.8,
    })

    const reversed = applyCommand(multicamProject(), { type: 'updateElement', elementId: 'e-mc', patch: { reversed: true } })
    expect(getActiveMediaItems(reversed, 500).find((item) => item.assetId === 'a-mic')).toEqual({
      assetId: 'a-mic',
      kind: 'audio',
      sourceTimeMs: 5700,
      rate: 1,
      volume: 0,
      reversed: true,
    })
  })

  test('a multicam on a hidden track is still heard until the track is also muted', () => {
    const hidden = applyCommand(multicamProject(), { type: 'setTrackFlags', trackId: 't-default', hidden: true })
    expect(getActiveMediaItems(hidden, 500).map((item) => item.volume)).toEqual([0, 0, 0.8])

    const silenced = applyCommand(hidden, { type: 'setTrackFlags', trackId: 't-default', muted: true })
    expect(getActiveMediaItems(silenced, 500)).toEqual([])
  })
})
