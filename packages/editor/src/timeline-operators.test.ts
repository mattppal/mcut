import { describe, expect, test } from 'bun:test'
import {
  EditorEngine,
  getElement,
  getGroupedElementIds,
  getLinkedElementIds,
  type AudioElement,
  type VideoElement,
} from '@mcut/timeline'
import {
  createSequentialVideoCollage,
  retimeSequentialCollage,
  splitSelectionAtPlayhead,
  unlinkElements,
} from './timeline-operators'

/** Engine with a video clip and its detached (linked) audio. */
function engineWithLinkedPair(): { engine: EditorEngine; videoId: `e-${string}`; audioId: `e-${string}` } {
  const engine = new EditorEngine()
  const trackId = engine.project.tracks[0]!.id
  engine.dispatch({
    type: 'addAsset',
    asset: { id: 'a-vid', kind: 'video', src: 'blob:video', durationMs: 10_000 },
  })
  engine.dispatch({
    type: 'addElement',
    trackId,
    element: {
      type: 'video',
      id: 'e-vid',
      assetId: 'a-vid',
      startMs: 1000,
      durationMs: 4000,
      trimStartMs: 0,
    },
  })
  engine.dispatch({ type: 'detachAudio', elementId: 'e-vid', audioElementId: 'e-aud' })
  return { engine, videoId: 'e-vid', audioId: 'e-aud' }
}

describe('link-aware operators', () => {
  test('getLinkedElementIds returns self first plus partners', () => {
    const { engine, videoId, audioId } = engineWithLinkedPair()
    expect(getLinkedElementIds(engine.project, videoId)).toEqual([videoId, audioId])
    expect(getLinkedElementIds(engine.project, audioId)).toEqual([audioId, videoId])
  })

  test('splitSelectionAtPlayhead splits linked partners and re-pairs the halves', () => {
    const { engine, videoId, audioId } = engineWithLinkedPair()
    engine.select([videoId]) // partner is pulled in by the link, not the selection
    engine.seek(3000)
    splitSelectionAtPlayhead(engine)

    const elements = engine.project.tracks.flatMap((t) => t.elements)
    expect(elements).toHaveLength(4)
    const leftVideo = elements.find((e) => e.id === videoId) as VideoElement
    const leftAudio = elements.find((e) => e.id === audioId) as AudioElement
    const rightVideo = elements.find((e) => e.type === 'video' && e.id !== videoId) as VideoElement
    const rightAudio = elements.find((e) => e.type === 'audio' && e.id !== audioId) as AudioElement

    expect(leftVideo.linkId).toBe(leftAudio.linkId!)
    expect(rightVideo.linkId).toBe(rightAudio.linkId!)
    expect(rightVideo.linkId).not.toBe(leftVideo.linkId)
    expect(rightVideo.startMs).toBe(3000)
    expect(rightAudio.startMs).toBe(3000)
  })

  test('unlinkElements clears linkId on the whole group', () => {
    const { engine, videoId, audioId } = engineWithLinkedPair()
    unlinkElements(engine, videoId)
    const elements = engine.project.tracks.flatMap((t) => t.elements)
    expect(elements.find((e) => e.id === videoId)?.linkId).toBeUndefined()
    expect(elements.find((e) => e.id === audioId)?.linkId).toBeUndefined()
    expect(getLinkedElementIds(engine.project, videoId)).toEqual([videoId])
  })
})

describe('sequential video collage', () => {
  test('builds grouped freeze, active, and audio pieces', () => {
    const engine = new EditorEngine()
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-one',
        kind: 'video',
        src: 'blob:one',
        durationMs: 1000,
        width: 1920,
        height: 1080,
      },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-two',
        kind: 'video',
        src: 'blob:two',
        durationMs: 2000,
        width: 1280,
        height: 720,
      },
    })

    const result = createSequentialVideoCollage(engine, {
      assets: [engine.project.assets['a-one']!, engine.project.assets['a-two']!],
    })

    expect(result.layout).toBe('vertical')
    expect(result.totalDurationMs).toBe(3000)
    expect(engine.project.width).toBe(1920)
    expect(engine.project.height).toBe(2160)
    expect(engine.project.tracks).toHaveLength(3)
    expect(engine.project.tracks.every((track) => !track.locked && !track.magnetic)).toBe(true)
    expect(result.groupIds).toHaveLength(2)
    expect(result.visualTrackIds).toHaveLength(2)
    expect(result.activeVideoElementIds).toHaveLength(2)
    expect(result.audioElementIds).toHaveLength(2)

    const videos = engine.project.tracks
      .flatMap((track) => track.elements)
      .filter((element): element is VideoElement => element.type === 'video')
    const audios = engine.project.tracks
      .flatMap((track) => track.elements)
      .filter((element): element is AudioElement => element.type === 'audio')

    expect(videos).toHaveLength(4)
    expect(audios.map((element) => [element.startMs, element.durationMs])).toEqual([
      [0, 1000],
      [1000, 2000],
    ])
    const firstGroup = getGroupedElementIds(engine.project, result.activeVideoElementIds[0]!)
      .map((id) => getElement(engine.project, id)!)
    const secondGroup = getGroupedElementIds(engine.project, result.activeVideoElementIds[1]!)
      .map((id) => getElement(engine.project, id)!)
    expect(firstGroup).toHaveLength(3)
    expect(secondGroup).toHaveLength(3)
    expect(firstGroup.every((element) => element.groupId === result.groupIds[0])).toBe(true)
    expect(secondGroup.every((element) => element.groupId === result.groupIds[1])).toBe(true)

    const firstVideos = firstGroup.filter((element): element is VideoElement => element.type === 'video')
    const firstActive = firstVideos.find((element) => element.id === result.activeVideoElementIds[0])!
    const firstAfterFreeze = firstVideos.find((element) => element.id !== firstActive.id)!
    expect(firstActive.startMs).toBe(0)
    expect(firstActive.durationMs).toBe(1000)
    expect(firstActive.muted).toBe(true)
    expect(firstActive.volume).toBe(0)
    expect(firstAfterFreeze.startMs).toBe(1000)
    expect(firstAfterFreeze.durationMs).toBe(2000)
    expect(firstAfterFreeze.muted).toBe(true)
    expect(firstAfterFreeze.timeMap).toEqual([
      { timeMs: 0, value: 1000 },
      { timeMs: 2000, value: 1000 },
    ])

    const secondVideos = secondGroup.filter((element): element is VideoElement => element.type === 'video')
    const secondActive = secondVideos.find((element) => element.id === result.activeVideoElementIds[1])!
    const secondBeforeFreeze = secondVideos.find((element) => element.id !== secondActive.id)!
    expect(secondBeforeFreeze.startMs).toBe(0)
    expect(secondBeforeFreeze.durationMs).toBe(1000)
    expect(secondBeforeFreeze.timeMap).toEqual([
      { timeMs: 0, value: 0 },
      { timeMs: 1000, value: 0 },
    ])
    expect(secondActive.startMs).toBe(1000)
    expect(secondActive.durationMs).toBe(2000)
    expect(secondActive.transform.scaleX).toBe(1.5)
    expect(secondActive.transform.scaleY).toBe(1.5)
  })

  test('uses horizontal layout for portrait assets and applies centered zoom crops', () => {
    const engine = new EditorEngine()
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-one',
        kind: 'video',
        src: 'blob:one',
        durationMs: 1000,
        width: 1080,
        height: 1920,
      },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-two',
        kind: 'video',
        src: 'blob:two',
        durationMs: 1000,
        width: 1080,
        height: 1920,
      },
    })

    const result = createSequentialVideoCollage(engine, {
      assets: [engine.project.assets['a-one']!, engine.project.assets['a-two']!],
      zooms: [1, 2],
    })

    const videos = result.activeVideoElementIds
      .map((id) => getElement(engine.project, id))
      .filter((element): element is VideoElement => element?.type === 'video')
    expect(engine.project.width).toBe(2160)
    expect(engine.project.height).toBe(1920)
    expect(videos.map((element) => element.transform.x)).toEqual([-540, 540])
    expect(videos[1]!.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(videos[1]!.transform.scaleX).toBe(2)
    expect(videos[1]!.transform.scaleY).toBe(2)
  })

  test('retimes later groups and freeze regions after an active trim', () => {
    const engine = new EditorEngine()
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-one',
        kind: 'video',
        src: 'blob:one',
        durationMs: 1000,
        width: 1920,
        height: 1080,
      },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-two',
        kind: 'video',
        src: 'blob:two',
        durationMs: 2000,
        width: 1920,
        height: 1080,
      },
    })
    const result = createSequentialVideoCollage(engine, {
      assets: [engine.project.assets['a-one']!, engine.project.assets['a-two']!],
    })

    engine.dispatch({
      type: 'trimEdge',
      elementId: result.activeVideoElementIds[0]!,
      edge: 'end',
      deltaMs: -500,
    })
    const retimed = retimeSequentialCollage(engine)!

    expect(retimed.totalDurationMs).toBe(2500)
    const firstActive = getElement(engine.project, result.activeVideoElementIds[0]!) as VideoElement
    const secondActive = getElement(engine.project, result.activeVideoElementIds[1]!) as VideoElement
    expect(firstActive.startMs).toBe(0)
    expect(firstActive.durationMs).toBe(500)
    expect(secondActive.startMs).toBe(500)

    const audios = retimed.audioElementIds.map((id) => getElement(engine.project, id) as AudioElement)
    expect(audios.map((element) => [element.startMs, element.durationMs])).toEqual([
      [0, 500],
      [500, 2000],
    ])
    const secondBeforeFreeze = getGroupedElementIds(engine.project, result.activeVideoElementIds[1]!)
      .map((id) => getElement(engine.project, id)!)
      .filter((element): element is VideoElement => element.type === 'video')
      .find((element) => element.id !== result.activeVideoElementIds[1])!
    expect(secondBeforeFreeze.startMs).toBe(0)
    expect(secondBeforeFreeze.durationMs).toBe(500)
    expect(secondBeforeFreeze.timeMap).toEqual([
      { timeMs: 0, value: 0 },
      { timeMs: 500, value: 0 },
    ])
  })

  test('rejects mixed video aspect ratios', () => {
    const engine = new EditorEngine()
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-wide',
        kind: 'video',
        src: 'blob:wide',
        durationMs: 1000,
        width: 1920,
        height: 1080,
      },
    })
    engine.dispatch({
      type: 'addAsset',
      asset: {
        id: 'a-tall',
        kind: 'video',
        src: 'blob:tall',
        durationMs: 1000,
        width: 1080,
        height: 1920,
      },
    })

    expect(() =>
      createSequentialVideoCollage(engine, {
        assets: [engine.project.assets['a-wide']!, engine.project.assets['a-tall']!],
      }),
    ).toThrow('same aspect ratio')
  })
})
