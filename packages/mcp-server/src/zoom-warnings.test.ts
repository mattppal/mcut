import { describe, expect, test } from 'bun:test'
import { applyCommand, createProject } from '@mcut/timeline'
import { severeZoomNote } from './zoom-warnings'

function projectWithZoom(scale: number) {
  let project = createProject({ width: 1280, height: 720 })
  const trackId = project.tracks[0]?.id ?? 't-default'
  project = applyCommand(project, { type: 'addAsset', asset: { id: 'a-v', kind: 'video', src: 'blob:v', durationMs: 60_000, width: 1280, height: 720 } })
  project = applyCommand(project, { type: 'addElement', trackId, element: { type: 'video', id: 'e-v', assetId: 'a-v', startMs: 0, durationMs: 20_000 } })
  return applyCommand(project, { type: 'addZoomRegion', elementId: 'e-v', zoom: { id: 'z-detail', atMs: 0, focus: { x: 0.5, y: 0.5 }, scale } })
}

describe('severe zoom warning', () => {
  test('names each zoom above 1.5x and stays silent at the detail preset', () => {
    expect(severeZoomNote(projectWithZoom(2))).toContain('z-detail on e-v at 2x')
    expect(severeZoomNote(projectWithZoom(1.3))).toBe('')
  })
})
