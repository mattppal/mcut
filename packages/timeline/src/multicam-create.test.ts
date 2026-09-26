import { describe, expect, test } from 'bun:test'
import { resolveElementAudioSource } from './audio-source'
import { applyCommand } from './commands'
import { getFrameRequests } from './frame-requests'
import type { ElementId } from './id'
import { createProject, type Project } from './model'
import { getElement } from './selectors'
import { mustFind, thrownBy } from './test-helpers'

function recordings(options: { camDurationMs?: number } = {}): Project {
  let project = createProject({ fps: 30 })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: options.camDurationMs ?? 60_000 } })
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-mic', kind: 'audio', src: 'blob:m', durationMs: 50_000 } })
  project = applyCommand(project, { type: 'addTrack' })
  project = applyCommand(project, { type: 'addTrack' })
  const [bottom, middle, top] = project.tracks.map((track) => track.id)
  const place = (trackId: typeof bottom, element: object) => applyCommand(project, { type: 'addElement', trackId: mustFind(trackId, 'track'), element })
  const camDurationMs = Math.min(30_000, options.camDurationMs ?? 30_000)
  project = place(bottom, { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 0, durationMs: camDurationMs })
  project = place(middle, { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 30_000 })
  project = place(top, { id: 'e-mic', type: 'audio', assetId: 'a-mic', startMs: 0, durationMs: 30_000, trimStartMs: 1200 })
  return project
}

const element = (project: Project, id: ElementId) => mustFind(getElement(project, id), id)

describe('createMulticam from placed clips', () => {
  test('takes explicit roles, an audio-only source, and the audio source it is given', () => {
    const project = applyCommand(recordings(), {
      type: 'createMulticam',
      sources: [
        { elementId: 'e-screen', key: 'screen' },
        { elementId: 'e-cam', key: 'camera' },
        { elementId: 'e-mic', key: 'mic' },
      ],
      audioSource: 'mic',
      multicamId: 'e-mc',
    })
    expect(element(project, 'e-mc')).toMatchObject({
      type: 'multicam',
      startMs: 0,
      durationMs: 30_000,
      trimStartMs: 0,
      sources: [
        { key: 'screen', assetId: 'a-screen', offsetMs: 0 },
        { key: 'camera', assetId: 'a-cam', offsetMs: 0 },
        { key: 'mic', assetId: 'a-mic', offsetMs: 1200 },
      ],
      audioSource: 'mic',
    })
    expect(resolveElementAudioSource(project, 'e-mc')).toMatchObject({ assetId: 'a-mic', sourceStartMs: 1200, sourceEndMs: 31_200 })
    expect(project.tracks.flatMap((track) => track.elements.map((e) => e.id))).toEqual(['e-mc'])
  })

  test('defaults keys by stacking order and takes audio from the audio-only source', () => {
    const project = applyCommand(recordings(), {
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }, { elementId: 'e-mic' }],
      multicamId: 'e-mc',
    })
    expect(element(project, 'e-mc')).toMatchObject({
      sources: [
        { key: 'camera', assetId: 'a-screen' },
        { key: 'screen', assetId: 'a-cam' },
        { key: 'audio', assetId: 'a-mic' },
      ],
      audioSource: 'audio',
    })
  })

  test('keeps a late clip at the offset it was placed with', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addTrack' })
    const [screenTrack, cameraTrack] = project.tracks.map((track) => track.id)
    project = applyCommand(project, {
      type: 'addElement',
      trackId: mustFind(screenTrack, 'track'),
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 20_000, trimStartMs: 0 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId: mustFind(cameraTrack, 'track'),
      element: { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 3000, durationMs: 20_000, trimStartMs: 500 },
    })
    const before = [...getFrameRequests(project, element(project, 'e-screen'), 5000), ...getFrameRequests(project, element(project, 'e-cam'), 5000)]
    const grouped = applyCommand(project, {
      type: 'createMulticam',
      sources: [
        { elementId: 'e-screen', key: 'screen' },
        { elementId: 'e-cam', key: 'camera' },
      ],
      multicamId: 'e-mc',
    })
    expect(element(grouped, 'e-mc')).toMatchObject({
      startMs: 3000,
      sources: [
        { key: 'screen', offsetMs: 2500 },
        { key: 'camera', offsetMs: 0 },
      ],
    })
    expect(getFrameRequests(grouped, element(grouped, 'e-mc'), 5000)).toEqual(before)
    expect(before).toEqual([
      { assetId: 'a-screen', sourceTimeMs: 5000 },
      { assetId: 'a-cam', sourceTimeMs: 2500 },
    ])
  })

  test('cuts the multicam short to the shortest source', () => {
    const project = applyCommand(recordings({ camDurationMs: 20_000 }), {
      type: 'createMulticam',
      sources: [
        { elementId: 'e-screen', key: 'screen' },
        { elementId: 'e-cam', key: 'camera' },
      ],
      multicamId: 'e-mc',
    })
    expect(element(project, 'e-mc')).toMatchObject({ startMs: 0, durationMs: 20_000, audioSource: 'camera' })
  })

  test('names the overlap requirement when the selected clips do not share time', () => {
    let project = createProject({ fps: 30 })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000 } })
    project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 60_000 } })
    const trackId = mustFind(project.tracks[0]?.id, 'track')
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-screen', type: 'video', assetId: 'a-screen', startMs: 0, durationMs: 1_000 },
    })
    project = applyCommand(project, {
      type: 'addElement',
      trackId,
      element: { id: 'e-cam', type: 'video', assetId: 'a-cam', startMs: 2_000, durationMs: 1_000 },
    })
    expect(thrownBy(() => applyCommand(project, { type: 'createMulticam', sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }] }))).toMatchObject({
      code: 'out-of-bounds',
      message: "the selected clips don't overlap in time; stack clips recorded together on separate tracks so they overlap",
    })
  })

  test('rejects an audio-only group, a shared key, an unknown audio source, and a sped-up clip', () => {
    const project = recordings()
    const create = (payload: object) => thrownBy(() => applyCommand(project, { type: 'createMulticam', ...payload }))
    expect(create({ sources: [{ elementId: 'e-mic' }] })).toMatchObject({ code: 'invalid-payload' })
    expect(
      create({
        sources: [
          { elementId: 'e-screen', key: 'cam' },
          { elementId: 'e-cam', key: 'cam' },
        ],
      }),
    ).toMatchObject({ code: 'invalid-payload' })
    expect(create({ sources: [{ elementId: 'e-screen' }], audioSource: 'mic' })).toMatchObject({ code: 'unknown-source' })
    const sped = applyCommand(project, { type: 'setElementSpeed', elementId: 'e-cam', speed: 2 })
    expect(thrownBy(() => applyCommand(sped, { type: 'createMulticam', sources: [{ elementId: 'e-cam' }] }))).toMatchObject({ code: 'invalid-payload' })
  })
})

describe('detachAudio from a multicam', () => {
  test('moves the audio-only source onto an audio clip with the same window', () => {
    let project = applyCommand(recordings(), {
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen', key: 'screen' }, { elementId: 'e-cam', key: 'camera' }, { elementId: 'e-mic' }],
      multicamId: 'e-mc',
    })
    project = applyCommand(project, { type: 'trimEdge', elementId: 'e-mc', edge: 'start', deltaMs: 2000 })
    project = applyCommand(project, { type: 'setKeyframe', elementId: 'e-mc', property: 'volume', timeMs: 0, value: 0.5 })
    project = applyCommand(project, { type: 'updateElement', elementId: 'e-mc', patch: { fadeInMs: 300, reversed: true } })
    project = applyCommand(project, { type: 'detachAudio', elementId: 'e-mc', audioElementId: 'e-mc-audio' })

    const multicam = element(project, 'e-mc')
    expect(multicam).toMatchObject({ muted: true, volume: 1 })
    expect(multicam.keyframes).toBeUndefined()
    expect(element(project, 'e-mc-audio')).toMatchObject({
      type: 'audio',
      assetId: 'a-mic',
      startMs: 2000,
      durationMs: 28_000,
      trimStartMs: 3200,
      reversed: true,
      fadeInMs: 300,
      linkId: multicam.linkId,
      keyframes: { volume: [{ timeMs: 0, value: 0.5 }] },
    })
  })

  test('rejects a multicam without an audio source and an audio clip', () => {
    let project = applyCommand(recordings(), {
      type: 'createMulticam',
      sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }],
      multicamId: 'e-mc',
    })
    project = applyCommand(project, { type: 'setMulticamAudio', elementId: 'e-mc', sourceKey: null })
    expect(thrownBy(() => applyCommand(project, { type: 'detachAudio', elementId: 'e-mc' }))).toMatchObject({ code: 'invalid-payload' })
    expect(thrownBy(() => applyCommand(recordings(), { type: 'detachAudio', elementId: 'e-mic' }))).toMatchObject({ code: 'invalid-payload' })
  })
})
