import { getProjectCaptions, type Project, type ProjectCaptionRef } from '@mcut/timeline'

const CONTEXT_WORDS = 8

interface SpokenWord {
  text: string
  key: string
  startMs: number
  endMs: number
  captionId: string
}

interface SpokenTrack {
  trackId: string
  trackName: string
  words: SpokenWord[]
  joined: string
  offsets: number[]
}

export interface TranscriptSearchMatch {
  text: string
  startMs: number
  endMs: number
  before: string
  after: string
  pauseBeforeMs: number | null
  pauseAfterMs: number | null
  captionId: string
  trackId: string
  trackName: string
}

export interface TranscriptSearchResult {
  query: string
  count: number
  matches: TranscriptSearchMatch[]
}

const searchKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function captionWords({ caption }: ProjectCaptionRef): Omit<SpokenWord, 'key'>[] {
  const words = caption.words ?? []
  if (words.length === 0) return [{ text: caption.text, startMs: caption.startMs, endMs: caption.startMs + caption.durationMs, captionId: caption.id }]
  return words.map((word) => ({ text: word.text, startMs: caption.startMs + word.startMs, endMs: caption.startMs + word.endMs, captionId: caption.id }))
}

function spokenTracks(project: Project): SpokenTrack[] {
  const byTrack = new Map<string, SpokenTrack>()
  for (const ref of getProjectCaptions(project)) {
    const track = byTrack.get(ref.trackId) ?? { trackId: ref.trackId, trackName: ref.trackName, words: [], joined: '', offsets: [] }
    byTrack.set(ref.trackId, track)
    for (const word of captionWords(ref)) {
      const key = searchKey(word.text)
      if (key.length === 0) continue
      track.offsets.push(track.joined.length)
      track.joined += `${key} `
      track.words.push({ ...word, key })
    }
  }
  return [...byTrack.values()]
}

const gapMs = (from: SpokenWord | undefined, to: SpokenWord | undefined): number | null => (from && to ? Math.max(0, to.startMs - from.endMs) : null)

const spoken = (words: readonly SpokenWord[]): string => words.map((word) => word.text).join(' ')

function trackMatches(track: SpokenTrack, needle: string): TranscriptSearchMatch[] {
  const matches: TranscriptSearchMatch[] = []
  for (let at = track.joined.indexOf(needle); at >= 0; at = track.joined.indexOf(needle, at + 1)) {
    const first = track.offsets.findLastIndex((offset) => offset <= at)
    const last = track.offsets.findLastIndex((offset) => offset < at + needle.length)
    const firstWord = track.words[first]
    const lastWord = track.words[last]
    if (!firstWord || !lastWord) continue
    matches.push({
      text: spoken(track.words.slice(first, last + 1)),
      startMs: firstWord.startMs,
      endMs: Math.max(firstWord.startMs, lastWord.endMs),
      before: spoken(track.words.slice(Math.max(0, first - CONTEXT_WORDS), first)),
      after: spoken(track.words.slice(last + 1, last + 1 + CONTEXT_WORDS)),
      pauseBeforeMs: gapMs(track.words[first - 1], firstWord),
      pauseAfterMs: gapMs(lastWord, track.words[last + 1]),
      captionId: firstWord.captionId,
      trackId: track.trackId,
      trackName: track.trackName,
    })
  }
  return matches
}

export function searchProjectTranscript(project: Project, queries: readonly string[]): TranscriptSearchResult[] {
  const tracks = spokenTracks(project)
  return queries.map((query) => {
    const needle = searchKey(query)
    const matches = needle.length === 0 ? [] : tracks.flatMap((track) => trackMatches(track, needle)).sort((a, b) => a.startMs - b.startMs)
    return { query, count: matches.length, matches }
  })
}
