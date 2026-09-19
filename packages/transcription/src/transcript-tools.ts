import { MIN_ELEMENT_DURATION_MS, type CaptionWord } from '@mcut/timeline'

export interface TranscriptCaption {
  id: string
  startMs: number
  durationMs: number
  text: string
  words?: CaptionWord[]
}

export interface TranscriptMatch {
  captionId: string
  startChar: number
  endChar: number
  firstWord?: number
  lastWord?: number
  timeMs: number
  endTimeMs: number
}

export interface CaptionContentPatch {
  captionId: string
  text: string
  words?: CaptionWord[]
}

export interface MappedWord {
  word: CaptionWord
  startChar: number
  endChar: number
}

export function mapCaptionWords(caption: TranscriptCaption): MappedWord[] | null {
  const words = caption.words
  if (!words || words.length === 0) return null
  const mapped: MappedWord[] = []
  let cursor = 0
  for (const word of words) {
    if (word.text.length === 0) return null
    const at = caption.text.indexOf(word.text, cursor)
    if (at < 0) return null
    mapped.push({ word, startChar: at, endChar: at + word.text.length })
    cursor = at + word.text.length
  }
  return mapped
}

export function searchCaptions(captions: readonly TranscriptCaption[], query: string): TranscriptMatch[] {
  const needle = query.toLowerCase()
  if (needle.length === 0) return []
  const matches: TranscriptMatch[] = []
  for (const caption of captions) {
    const haystack = caption.text.toLowerCase()
    const mapped = mapCaptionWords(caption)
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      const endChar = at + needle.length
      matches.push(buildMatch(caption, mapped, at, endChar))
      from = at + Math.max(1, needle.length)
    }
  }
  return matches.sort((a, b) => a.timeMs - b.timeMs || a.startChar - b.startChar)
}

function buildMatch(caption: TranscriptCaption, mapped: MappedWord[] | null, startChar: number, endChar: number): TranscriptMatch {
  let firstWord: number | undefined
  let lastWord: number | undefined
  if (mapped) {
    for (let i = 0; i < mapped.length; i++) {
      const m = mapped[i]!
      if (m.endChar <= startChar) continue
      if (m.startChar >= endChar) break
      firstWord ??= i
      lastWord = i
    }
  }
  const start = mapped && firstWord !== undefined ? caption.startMs + mapped[firstWord]!.word.startMs : caption.startMs
  const end = mapped && lastWord !== undefined ? caption.startMs + mapped[lastWord]!.word.endMs : caption.startMs + caption.durationMs
  return {
    captionId: caption.id,
    startChar,
    endChar,
    ...(firstWord !== undefined ? { firstWord } : {}),
    ...(lastWord !== undefined ? { lastWord } : {}),
    timeMs: start,
    endTimeMs: Math.max(start, end),
  }
}

function spliceMatch(caption: TranscriptCaption, match: TranscriptMatch, replacement: string): { text: string; words: CaptionWord[] | null } {
  const text = caption.text.slice(0, match.startChar) + replacement + caption.text.slice(match.endChar)
  const mapped = mapCaptionWords(caption)
  if (!mapped || match.firstWord === undefined || match.lastWord === undefined) {
    return { text, words: null }
  }

  const first = mapped[match.firstWord]!
  const last = mapped[match.lastWord]!
  const spanText = caption.text.slice(first.startChar, match.startChar) + replacement + caption.text.slice(match.endChar, last.endChar)
  const tokens = spanText.split(/\s+/).filter((t) => t.length > 0)
  const spanStartMs = first.word.startMs
  const spanEndMs = Math.max(spanStartMs, last.word.endMs)
  const replacementWords = distributeTokens(tokens, spanStartMs, spanEndMs)

  const words = [...mapped.slice(0, match.firstWord).map((m) => m.word), ...replacementWords, ...mapped.slice(match.lastWord + 1).map((m) => m.word)]
  return { text, words }
}

export function replaceMatch(caption: TranscriptCaption, match: TranscriptMatch, replacement: string): CaptionContentPatch {
  const spliced = spliceMatch(caption, match, replacement)
  return {
    captionId: caption.id,
    text: collapseSpaces(spliced.text),
    ...(spliced.words ? { words: spliced.words } : {}),
  }
}

export function replaceAllMatches(captions: readonly TranscriptCaption[], query: string, replacement: string): CaptionContentPatch[] {
  const patches: CaptionContentPatch[] = []
  for (const caption of captions) {
    const matches = searchCaptions([caption], query)
    if (matches.length === 0) continue
    let current: TranscriptCaption = caption
    let wordsValid = mapCaptionWords(caption) !== null
    for (const match of matchesFromRight(matches)) {
      const spliced = spliceMatch(current, match, replacement)
      wordsValid &&= spliced.words !== null
      current = { ...current, text: spliced.text, words: spliced.words ?? [] }
    }
    patches.push({
      captionId: caption.id,
      text: collapseSpaces(current.text),
      ...(wordsValid && current.words ? { words: current.words } : {}),
    })
  }
  return patches
}

export function retypeWord(caption: TranscriptCaption, wordIndex: number, newText: string): CaptionContentPatch | null {
  const mapped = mapCaptionWords(caption)
  const target = mapped?.[wordIndex]
  if (!mapped || !target) return null
  const match = buildMatch(caption, mapped, target.startChar, target.endChar)
  return replaceMatch(caption, match, newText.trim())
}

function distributeTokens(tokens: string[], startMs: number, endMs: number): CaptionWord[] {
  if (tokens.length === 0) return []
  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0)
  const span = Math.max(0, endMs - startMs)
  const words: CaptionWord[] = []
  let cursorMs = startMs
  let usedChars = 0
  for (const [i, token] of tokens.entries()) {
    usedChars += token.length
    const end = i === tokens.length - 1 ? endMs : startMs + Math.round((span * usedChars) / Math.max(1, totalChars))
    words.push({ text: token, startMs: Math.round(cursorMs), endMs: Math.max(Math.round(cursorMs), end) })
    cursorMs = end
  }
  return words
}

function collapseSpaces(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

function matchesFromRight(matches: readonly TranscriptMatch[]): TranscriptMatch[] {
  return [...matches].sort((a, b) => b.startChar - a.startChar)
}

export interface CaptionSplitResult {
  left: { text: string; words: CaptionWord[]; durationMs: number }
  right: {
    startMs: number
    durationMs: number
    text: string
    words: CaptionWord[]
  }
}

export function splitCaptionAtWord(caption: TranscriptCaption, wordIndex: number): CaptionSplitResult | null {
  const mapped = mapCaptionWords(caption)
  if (!mapped || wordIndex <= 0 || wordIndex >= mapped.length) return null
  const boundary = mapped[wordIndex]!
  const boundaryMs = boundary.word.startMs
  const leftDuration = boundaryMs
  const rightDuration = caption.durationMs - boundaryMs
  if (leftDuration < MIN_ELEMENT_DURATION_MS || rightDuration < MIN_ELEMENT_DURATION_MS) return null
  return {
    left: {
      text: caption.text.slice(0, boundary.startChar).trim(),
      words: mapped.slice(0, wordIndex).map((m) => m.word),
      durationMs: leftDuration,
    },
    right: {
      startMs: caption.startMs + boundaryMs,
      durationMs: rightDuration,
      text: caption.text.slice(boundary.startChar).trim(),
      words: mapped.slice(wordIndex).map((m) => ({
        text: m.word.text,
        startMs: Math.max(0, m.word.startMs - boundaryMs),
        endMs: Math.max(0, m.word.endMs - boundaryMs),
      })),
    },
  }
}

export interface CaptionMergeResult {
  startMs: number
  durationMs: number
  text: string
  words?: CaptionWord[]
}

export function mergeCaptions(a: TranscriptCaption, b: TranscriptCaption): CaptionMergeResult {
  const [first, second] = a.startMs <= b.startMs ? [a, b] : [b, a]
  const startMs = first.startMs
  const endMs = Math.max(first.startMs + first.durationMs, second.startMs + second.durationMs)
  const offset = second.startMs - first.startMs
  const text = collapseSpaces(`${first.text} ${second.text}`)
  const firstWords = first.words ?? []
  const secondWords = second.words ?? []
  if (firstWords.length === 0 || secondWords.length === 0) {
    return { startMs, durationMs: endMs - startMs, text }
  }
  return {
    startMs,
    durationMs: endMs - startMs,
    text,
    words: [
      ...firstWords,
      ...secondWords.map((w) => ({
        text: w.text,
        startMs: w.startMs + offset,
        endMs: w.endMs + offset,
      })),
    ],
  }
}
