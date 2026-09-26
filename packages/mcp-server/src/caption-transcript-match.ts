import { getProjectCaptions, type Project } from '@mcut/timeline'
import type { TranscriptResult } from '@mcut/transcription'

function spokenWordList(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

function isOrderedSubsequence(needle: readonly string[], haystack: readonly string[]): boolean {
  if (needle.length === 0) return false
  let index = 0
  for (const word of haystack) {
    if (word === needle[index]) {
      index += 1
      if (index === needle.length) return true
    }
  }
  return false
}

export function captionTranscriptsMatch(incomingText: string, projectText: string): boolean {
  const incoming = spokenWordList(incomingText)
  const project = spokenWordList(projectText)
  return isOrderedSubsequence(project, incoming) || isOrderedSubsequence(incoming, project)
}

export function transcriptOriginNote(given: TranscriptResult | undefined, project: Project): string {
  if (!given) return 'Used the transcript stored for this audio.'
  const incomingText = given.words.length > 0 ? given.words.map((word) => word.text).join(' ') : given.text
  const projectText = getProjectCaptions(project)
    .map(({ caption }) => caption.text)
    .join(' ')
  return captionTranscriptsMatch(incomingText, projectText)
    ? 'The transcript matches captions already in the project.'
    : 'Warning: this transcript does not match any transcript in the project, so ensure_transcript did not produce it. ' +
        'If it did not come from a transcription provider either, undo and run ensure_transcript.'
}
