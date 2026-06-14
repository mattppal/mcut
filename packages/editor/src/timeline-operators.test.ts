import { describe, expect, test } from 'bun:test'
import { EditorEngine, getLinkedElementIds, type AudioElement, type VideoElement } from '@mcut/timeline'
import { splitSelectionAtPlayhead, unlinkElements } from './timeline-operators'

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
