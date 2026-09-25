import { listZoomRegions, type Project } from '@mcut/timeline'

const SEVERE_ZOOM_SCALE = 1.5

export function severeZoomNote(project: Project): string {
  const severe = listZoomRegions(project).filter((zoom) => zoom.scale > SEVERE_ZOOM_SCALE)
  if (severe.length === 0) return ''
  const list = severe.map((zoom) => `${zoom.id} on ${zoom.elementId} at ${zoom.scale}x`).join(', ')
  return `\n\nWarning: ${list}. Detail zooms usually stay between 1.1x and 1.35x, and above ${SEVERE_ZOOM_SCALE}x a zoom reads as severe. Lower the scale unless the edit calls for a strong zoom.`
}
