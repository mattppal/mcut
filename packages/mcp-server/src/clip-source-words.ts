import { CommandError, getElement, getSourceTimeMs, type ElementId, type Project, type ProjectTranscriptWordContext } from '@mcut/timeline'

export function toClipSourceWords(project: Project, elementId: ElementId, words: readonly ProjectTranscriptWordContext[]): ProjectTranscriptWordContext[] {
  const clip = getElement(project, elementId)
  if (clip?.type !== 'video' && clip?.type !== 'audio')
    throw new CommandError('invalid-payload', `find_retakes elementId must name a video or audio clip, got "${elementId}"`)
  if (clip.reversed) throw new CommandError('invalid-payload', `clip "${elementId}" plays reversed, so its captions have no forward source time`)
  if (clip.timeMap) throw new CommandError('invalid-payload', `clip "${elementId}" has a time remap, so apply_captions cannot rebuild its captions`)
  const endMs = clip.startMs + clip.durationMs
  return words
    .filter((word) => word.startMs >= clip.startMs && word.startMs < endMs)
    .map((word) => ({
      text: word.text,
      startMs: Math.round(getSourceTimeMs(clip, word.startMs - clip.startMs)),
      endMs: Math.round(getSourceTimeMs(clip, Math.min(word.endMs, endMs) - clip.startMs)),
    }))
}
