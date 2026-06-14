import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject, type AnyCommand, type Project, type VideoElement } from '@mcut/timeline'
import {
  collectClipDragBases,
  computeSlipRange,
  planAutoCrossfade,
  planDuplicateClipsToNewTracks,
  resolveToolMode,
} from './timeline-gesture'

function applyCommands(project: Project, commands: readonly AnyCommand[]): Project {
  return commands.reduce((next, command) => applyCommand(next, command), project)
}

function projectWithAdjacentClips(): Project {
  let project = createProject({ name: 'gesture' })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-video', kind: 'video', src: 'video.mp4', durationMs: 20_000 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: {
      id: 'e-left',
      type: 'video',
      assetId: 'a-video',
      startMs: 0,
      durationMs: 2000,
      trimStartMs: 0,
    },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: {
      id: 'e-mid',
      type: 'video',
      assetId: 'a-video',
      startMs: 2000,
      durationMs: 3000,
      trimStartMs: 1000,
    },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: {
      id: 'e-right',
      type: 'video',
      assetId: 'a-video',
      startMs: 5000,
      durationMs: 2000,
      trimStartMs: 0,
    },
  })
  return project
}

describe('timeline gesture planning', () => {
  test('collects drag bases without UI dependencies', () => {
    const project = projectWithAdjacentClips()
    const bases = collectClipDragBases(project, ['e-mid'])
    expect(bases.get('e-mid')).toMatchObject({
      startMs: 2000,
      durationMs: 3000,
      trimStartMs: 1000,
      trackIndex: 0,
    })
  })

  test('resolves desktop edit tools to supported gestures', () => {
    const project = projectWithAdjacentClips()
    expect(resolveToolMode(project, 'roll-start', ['e-mid'])).toEqual({
      mode: 'roll-start',
      rollTargetId: 'e-left',
    })
    expect(resolveToolMode(project, 'roll-end', ['e-mid'])).toEqual({
      mode: 'roll-end',
      rollTargetId: 'e-mid',
    })

    const isolated = applyCommand(project, { type: 'moveElement', elementId: 'e-right', startMs: 8000 })
    expect(resolveToolMode(isolated, 'slide', ['e-mid'])).toEqual({ mode: 'move', rollTargetId: null })
  })

  test('computes slip range across slippable clips', () => {
    const project = projectWithAdjacentClips()
    expect(computeSlipRange(project, ['e-mid'])).toEqual({ minMs: -1000, maxMs: 16_000 })
  })

  test('plans duplicate clips onto new tracks as serializable commands', () => {
    const project = projectWithAdjacentClips()
    const plan = planDuplicateClipsToNewTracks(project, ['e-mid', 'e-left'], {
      createTrackId: () => 't-copy',
      createElementId: (() => {
        const ids = ['e-mid-copy', 'e-left-copy'] as const
        let index = 0
        return () => ids[index++]!
      })(),
    })

    expect(plan?.createdTrackIds).toEqual(['t-copy'])
    expect(plan?.ids).toEqual(['e-mid-copy', 'e-left-copy'])
    const next = applyCommands(project, plan!.commands)
    const copiedTrack = next.tracks.find((track) => track.id === 't-copy')
    expect(copiedTrack?.elements.map((element) => element.id)).toEqual(['e-left-copy', 'e-mid-copy'])
  })

  test('plans auto-crossfade for attempted overlaps at butt cuts', () => {
    const project = projectWithAdjacentClips()
    expect(planAutoCrossfade(project, { elementId: 'e-mid', desiredStartMs: 1750 })).toEqual({
      type: 'setTransition',
      elementId: 'e-left',
      transition: { type: 'dissolve', durationMs: 250 },
    })
    expect(planAutoCrossfade(project, { elementId: 'e-mid', desiredStartMs: 2250 })).toEqual({
      type: 'setTransition',
      elementId: 'e-mid',
      transition: { type: 'dissolve', durationMs: 250 },
    })
  })

  test('skips auto-crossfade when a transition already exists', () => {
    let project = projectWithAdjacentClips()
    project = applyCommand(project, {
      type: 'setTransition',
      elementId: 'e-left',
      transition: { type: 'dissolve', durationMs: 300 },
    })
    const left = project.tracks[0]!.elements.find((element) => element.id === 'e-left') as VideoElement
    expect(left.transition?.durationMs).toBe(300)
    expect(planAutoCrossfade(project, { elementId: 'e-mid', desiredStartMs: 1700 })).toBeNull()
  })
})
