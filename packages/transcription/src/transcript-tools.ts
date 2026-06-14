import { MIN_ELEMENT_DURATION_MS, type CaptionWord } from '@mcut/timeline'

/**
 * Pure transcript tooling over word-timed captions: search, replace, and
 * repair. Works identically for AssemblyAI- and Whisper-produced transcripts
 * — the only contract is the caption element shape below (word timings are
 * relative to the caption's `startMs`, and optional: captions whose words
 * were invalidated by manual edits degrade to caption-level granularity).
 */

export interface TranscriptCaption {
  id: string
  startMs: number
  durationMs: number
  text: string
  words?: CaptionWord[]
}

/** A search hit inside one caption. */
export interface TranscriptMatch {
  captionId: string
  /** Character range in the caption's `text`. */
  startChar: number
  endChar: number
  /** Inclusive word-index range, when the caption's words map onto its text. */
  firstWord?: number
  lastWord?: number
  /** Absolute timeline time of the hit (word-accurate when words exist). */
  timeMs: number
  endTimeMs: number
}

/** A computed caption content change, ready for an `updateElement` patch. */
export interface CaptionContentPatch {
  captionId: string
  text: string
  /** Omitted = word timings could not be preserved; clear them. */
  words?: CaptionWord[]
}

// ---------------------------------------------------------------------------
// Word ↔ text mapping
// ---------------------------------------------------------------------------

export interface MappedWord {
  word: CaptionWord
  startChar: number
  endChar: number
}

/**
 * Locate each timed word inside the caption text (in order). Returns null
 * when the words no longer correspond to the text — e.g. after a free-form
 * manual edit — in which case callers degrade to caption-level behavior.
 */
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

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring search across captions. Substrings spanning
 * word boundaries match (the index is the caption text, not single words),
 * and each hit carries the word span + absolute time when word timings map.
 */
export function searchCaptions(
  captions: readonly TranscriptCaption[],
  query: string,
): TranscriptMatch[] {
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

function buildMatch(
  caption: TranscriptCaption,
  mapped: MappedWord[] | null,
  startChar: number,
  endChar: number,
): TranscriptMatch {
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
  const start =
    mapped && firstWord !== undefined
      ? caption.startMs + mapped[firstWord]!.word.startMs
      : caption.startMs
  const end =
    mapped && lastWord !== undefined
      ? caption.startMs + mapped[lastWord]!.word.endMs
      : caption.startMs + caption.durationMs
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

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

/**
 * Splice one match without normalizing whitespace — char offsets of earlier
 * matches stay valid, so replace-all can apply right-to-left.
 */
function spliceMatch(
  caption: TranscriptCaption,
  match: TranscriptMatch,
  replacement: string,
): { text: string; words: CaptionWord[] | null } {
  const text =
    caption.text.slice(0, match.startChar) + replacement + caption.text.slice(match.endChar)
  const mapped = mapCaptionWords(caption)
  if (!mapped || match.firstWord === undefined || match.lastWord === undefined) {
    // No word timings to preserve — plain text edit, clear stale words.
    return { text, words: null }
  }

  const first = mapped[match.firstWord]!
  const last = mapped[match.lastWord]!
  // The affected span's new text keeps whatever the match left of the
  // boundary words ("cat" replaced inside "category" keeps "egory").
  const spanText =
    caption.text.slice(first.startChar, match.startChar) +
    replacement +
    caption.text.slice(match.endChar, last.endChar)
  const tokens = spanText.split(/\s+/).filter((t) => t.length > 0)
  const spanStartMs = first.word.startMs
  const spanEndMs = Math.max(spanStartMs, last.word.endMs)
  const replacementWords = distributeTokens(tokens, spanStartMs, spanEndMs)

  const words = [
    ...mapped.slice(0, match.firstWord).map((m) => m.word),
    ...replacementWords,
    ...mapped.slice(match.lastWord + 1).map((m) => m.word),
  ]
  return { text, words }
}

/**
 * Replace one match, preserving word timings: the replacement's tokens map
 * onto the matched word span, with multi-word replacements distributing the
 * span's time proportionally to token length. Partial-word matches keep the
 * untouched prefix/suffix of the boundary words.
 */
export function replaceMatch(
  caption: TranscriptCaption,
  match: TranscriptMatch,
  replacement: string,
): CaptionContentPatch {
  const spliced = spliceMatch(caption, match, replacement)
  return {
    captionId: caption.id,
    text: collapseSpaces(spliced.text),
    ...(spliced.words ? { words: spliced.words } : {}),
  }
}

/** Replace every occurrence of `query` across the captions. */
export function replaceAllMatches(
  captions: readonly TranscriptCaption[],
  query: string,
  replacement: string,
): CaptionContentPatch[] {
  const patches: CaptionContentPatch[] = []
  for (const caption of captions) {
    const matches = searchCaptions([caption], query)
    if (matches.length === 0) continue
    let current: TranscriptCaption = caption
    let wordsValid = mapCaptionWords(caption) !== null
    // Right-to-left: earlier char offsets and word indices stay valid.
    for (const match of [...matches].sort((a, b) => b.startChar - a.startChar)) {
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

/** Repair: retype one word in place (fixes caption text + timing together). */
export function retypeWord(
  caption: TranscriptCaption,
  wordIndex: number,
  newText: string,
): CaptionContentPatch | null {
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
    const end =
      i === tokens.length - 1
        ? endMs
        : startMs + Math.round((span * usedChars) / Math.max(1, totalChars))
    words.push({ text: token, startMs: Math.round(cursorMs), endMs: Math.max(Math.round(cursorMs), end) })
    cursorMs = end
  }
  return words
}

function collapseSpaces(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Split / merge
// ---------------------------------------------------------------------------

export interface CaptionSplitResult {
  /** Patch for the existing caption (keeps its id). */
  left: { text: string; words: CaptionWord[]; durationMs: number }
  /** New caption element input for the right half. */
  right: {
    startMs: number
    durationMs: number
    text: string
    words: CaptionWord[]
  }
}

/**
 * Split a caption immediately BEFORE `wordIndex`. Returns null when the
 * boundary doesn't yield two valid captions (no word mapping, index at the
 * edges, or either half shorter than the minimum element duration).
 */
export function splitCaptionAtWord(
  caption: TranscriptCaption,
  wordIndex: number,
): CaptionSplitResult | null {
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

/**
 * Merge two captions (order-independent) into one spanning both. Word
 * timings survive when both sides carry them; otherwise the merged caption
 * degrades to caption-level granularity.
 */
export function mergeCaptions(
  a: TranscriptCaption,
  b: TranscriptCaption,
): CaptionMergeResult {
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
