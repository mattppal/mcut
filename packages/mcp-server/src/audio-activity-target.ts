import { getElementLocation, resolveElementAudioSource, type ElementAudioSource, type ElementId, type Project } from '@mcut/timeline'

export function pickAudioActivitySource(project: Project, selectedElementIds: readonly ElementId[], elementId?: ElementId): ElementAudioSource {
  if (elementId) {
    const source = resolveElementAudioSource(project, elementId)
    if (!source) throw new Error(missingAudioActivityMessage(project, elementId))
    return source
  }

  for (const id of selectedElementIds) {
    const source = resolveElementAudioSource(project, id)
    if (source) return source
  }

  for (const track of project.tracks) {
    for (const element of track.elements) {
      const source = resolveElementAudioSource(project, element.id)
      if (source) return source
    }
  }

  throw new Error('Add a clip with source audio to the timeline first.')
}

export function liveBridgeAudioActivityMessage(source: ElementAudioSource): string {
  return (
    'get_audio_activity requires a live browser bridge connected to an editor tab. ' +
    `Resolved element ${source.elementId} asset ${source.assetId} source ${source.sourceStartMs}-${source.sourceEndMs}ms.`
  )
}

function missingAudioActivityMessage(project: Project, elementId: ElementId): string {
  const location = getElementLocation(project, elementId)
  if (!location) return `Element "${elementId}" is not in the project.`
  if (location.element.type === 'multicam') return `Element "${elementId}" has no audio source. Set one with setMulticamAudio.`
  return `Element "${elementId}" has no source audio.`
}
