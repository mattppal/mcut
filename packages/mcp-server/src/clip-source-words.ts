import {
  CommandError,
  getElementLocation,
  isMediaClip,
  resolveElementAudioSource,
  type ElementId,
  type Project,
  type ProjectTranscriptWordContext,
} from '@mcut/timeline'

export function toClipSourceWords(project: Project, elementId: ElementId, words: readonly ProjectTranscriptWordContext[]): ProjectTranscriptWordContext[] {
  const location = getElementLocation(project, elementId)
  if (!location) throw new CommandError('invalid-payload', `find_retakes elementId must name a clip with source audio, got "${elementId}"`)
  const source = resolveElementAudioSource(project, elementId)
  if (!source) {
    if (location.element.type === 'multicam') {
      throw new CommandError('invalid-payload', `element "${elementId}" has no audio source; set one with setMulticamAudio`)
    }
    if (!isMediaClip(location.element)) {
      throw new CommandError('invalid-payload', `find_retakes applies to a clip with source audio, not "${location.element.type}"`)
    }
    throw new CommandError('invalid-payload', `element "${elementId}" has no audio asset`)
  }
  if (source.timeMap) throw new CommandError('invalid-payload', `clip "${elementId}" has a time remap, so apply_captions cannot rebuild its captions`)
  if (source.reversed) throw new CommandError('invalid-payload', `clip "${elementId}" plays reversed, so its captions have no forward source time`)

  const startMs = source.timelineStartMs
  const endMs = startMs + source.timelineDurationMs
  return words
    .filter((word) => word.startMs < endMs && (word.endMs > startMs || word.startMs >= startMs))
    .map((word) => {
      const clippedStart = Math.min(endMs, Math.max(startMs, word.startMs))
      const clippedEnd = Math.min(endMs, Math.max(startMs, word.endMs))
      return {
        text: word.text,
        startMs: Math.round(source.sourceStartMs + (clippedStart - startMs)),
        endMs: Math.round(source.sourceStartMs + (clippedEnd - startMs)),
      }
    })
    .filter((word) => word.endMs >= word.startMs)
}
