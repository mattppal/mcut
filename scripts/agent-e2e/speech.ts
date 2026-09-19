export interface SpeechWord {
  text: string
  startMs: number
  endMs: number
}

export interface SpeechGroup {
  startMs: number
  endMs: number
  words: SpeechWord[]
}

export interface SpeechScript {
  groups: [SpeechGroup, SpeechGroup]
  minGapMs: number
  paddingMs: number
  describe(): string
}

const PHRASES: [string[], string[]] = [
  ['welcome', 'to', 'mcut'],
  ['agents', 'edit', 'video'],
]

const LAYOUT = {
  firstStart: 0.1,
  firstEnd: 0.4,
  lastStart: 0.62,
  lastEnd: 0.88,
  wordGap: 0.02,
  minGap: 0.1,
  padding: 0.02,
  maxPaddingMs: 120,
}

function layGroup(texts: string[], startMs: number, endMs: number, gapMs: number): SpeechGroup {
  const count = texts.length
  const wordMs = Math.floor((endMs - startMs - gapMs * (count - 1)) / count)
  const words = texts.map((text, index): SpeechWord => {
    const wordStart = startMs + index * (wordMs + gapMs)
    return { text, startMs: wordStart, endMs: wordStart + wordMs }
  })
  return { startMs, endMs: startMs + count * wordMs + (count - 1) * gapMs, words }
}

export function syntheticSpeech(durationMs: number): SpeechScript {
  const at = (fraction: number): number => Math.round(durationMs * fraction)
  const gapMs = at(LAYOUT.wordGap)
  const groups: [SpeechGroup, SpeechGroup] = [
    layGroup(PHRASES[0], at(LAYOUT.firstStart), at(LAYOUT.firstEnd), gapMs),
    layGroup(PHRASES[1], at(LAYOUT.lastStart), at(LAYOUT.lastEnd), gapMs),
  ]
  return {
    groups,
    minGapMs: at(LAYOUT.minGap),
    paddingMs: Math.min(LAYOUT.maxPaddingMs, at(LAYOUT.padding)),
    describe: () =>
      groups
        .flatMap((group) => group.words)
        .map((word) => `${word.text} ${word.startMs} to ${word.endMs}`)
        .join(', '),
  }
}
