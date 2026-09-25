import { applyCommand } from './commands'
import { createProject, type MulticamElement, type Project } from './model'
import { getElement } from './selectors'

export function projectWithRecordings(): { project: Project; trackId: `t-${string}` } {
  let project = createProject({ name: 'mc', width: 1920, height: 1080 })
  const trackId = project.tracks[0]!.id
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-screen', kind: 'video', src: 'blob:s', durationMs: 60_000, width: 2560, height: 1440 },
  })
  project = applyCommand(project, {
    type: 'addAsset',
    asset: { id: 'a-cam', kind: 'video', src: 'blob:c', durationMs: 58_000, width: 1920, height: 1080 },
  })
  project = applyCommand(project, {
    type: 'addElement',
    trackId,
    element: { type: 'video', id: 'e-screen', assetId: 'a-screen', startMs: 0, durationMs: 30_000 },
  })
  project = applyCommand(project, {
    type: 'addTrack',
  })
  const camTrack = project.tracks[1]!.id
  project = applyCommand(project, {
    type: 'addElement',
    trackId: camTrack,
    element: {
      type: 'video',
      id: 'e-cam',
      assetId: 'a-cam',
      startMs: 0,
      durationMs: 30_000,
    },
  })
  return { project, trackId }
}

export function createMc(project: Project): Project {
  return applyCommand(project, {
    type: 'createMulticam',
    sources: [{ elementId: 'e-screen' }, { elementId: 'e-cam' }],
    multicamId: 'e-mc',
  })
}

export const mc = (p: Project) => getElement(p, 'e-mc' as `e-${string}`) as MulticamElement
