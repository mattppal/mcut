import { getElementLocation, resolveElementAudioSource, type ElementAudioSource, type ElementId, type Project } from '@mcut/timeline'

export const audioActivityDescription =
  'Live bridge only: analyze a clip with source audio and return compact sound and silence windows in audio-asset time. ' +
  'A multicam uses its audio source. A selected multicam with none fails until setMulticamAudio instead of falling through to another clip. ' +
  'The fallback is the first clip with source audio when the selection has none. ' +
  'Use this only through the connected browser for audio-aware inspection; do not fall back to ffmpeg. ' +
  'For spoken-word silence removal, prefer ensure_transcript followed by the live editor action transcript.remove-silence.'

export const applySilenceCutsDescription =
  'Cut transcript silence out of one clip with source audio (splits, ripple deletes, and edge trims) ' +
  'as one undoable edit. A multicam is cut on its audio source, before volume, fades, and mute. ' +
  'One with no audio source fails until setMulticamAudio. ' +
  'Returns the removed silence windows in audio-asset time and the updated project summary.'

export function pickAudioActivitySource(project: Project, selectedElementIds: readonly ElementId[], elementId?: ElementId): ElementAudioSource {
  if (elementId) {
    const source = resolveElementAudioSource(project, elementId)
    if (!source) throw new Error(missingAudioActivityMessage(project, elementId))
    return source
  }

  let resolved: ElementAudioSource | undefined
  for (const id of selectedElementIds) {
    const location = getElementLocation(project, id)
    if (!location) continue
    const source = resolveElementAudioSource(project, id)
    if (!source) {
      if (location.element.type === 'multicam') throw new Error(missingAudioActivityMessage(project, id))
      continue
    }
    if (!resolved) resolved = source
  }
  if (resolved) return resolved

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
