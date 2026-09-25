import { z } from 'zod'

export const retakeOptionsSchema = z.object({
  pauseMs: z.number().int().min(0).default(450).describe('A gap at least this long, or sentence punctuation, starts a new phrase.'),
  minMatchWords: z.number().int().min(2).default(6).describe('A retake repeats at least this many opening words of an earlier phrase.'),
  maxLookaheadMs: z.number().int().min(1000).default(20_000).describe('How far after a phrase start its restart may begin.'),
})

export type RetakeOptions = z.input<typeof retakeOptionsSchema>

interface TimedWord {
  text: string
  startMs: number
  endMs: number
}

export interface RetakeCandidate {
  startMs: number
  endMs: number
  abandonedText: string
  keptText: string
  matchedWords: number
}

const MAX_OPENING_DRIFT = 2

const FILLERS = new Set(['um', 'uh', 'erm', 'ah', 'hmm', 'mm'])

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '')

interface Token {
  norm: string
  word: TimedWord
}

function phraseStarts(tokens: readonly Token[], pauseMs: number): number[] {
  return tokens.flatMap((token, index) => {
    const previous = tokens[index - 1]
    if (!previous) return [index]
    return token.word.startMs - previous.word.endMs >= pauseMs || /[.?!]$/.test(previous.word.text.trim()) ? [index] : []
  })
}

function sharedRun(tokens: readonly Token[], a: number, b: number): number {
  let length = 0
  while (b + length < tokens.length && a + length < b && tokens[a + length]?.norm === tokens[b + length]?.norm) length++
  return length
}

const textOf = (tokens: readonly Token[], from: number, to: number) =>
  tokens
    .slice(from, to)
    .map((t) => t.word.text.trim())
    .join(' ')

export function findRetakes(words: readonly TimedWord[], options: RetakeOptions = {}): RetakeCandidate[] {
  const { pauseMs, minMatchWords, maxLookaheadMs } = retakeOptionsSchema.parse(options)
  const tokens = words.map((word) => ({ norm: normalize(word.text), word })).filter((t) => t.norm !== '' && !FILLERS.has(t.norm))
  const starts = phraseStarts(tokens, pauseMs)
  const isPhraseStart = new Set(starts)
  const candidates: RetakeCandidate[] = []
  let coveredUntil = -1
  for (const start of starts) {
    const first = tokens[start]
    if (!first || start < coveredUntil) continue
    let restart: { index: number; length: number } | null = null
    for (let k = start + minMatchWords; k < tokens.length; k++) {
      const candidate = tokens[k]
      if (!candidate || candidate.word.startMs - first.word.startMs > maxLookaheadMs) break
      for (let offset = 0; offset <= MAX_OPENING_DRIFT && k - offset > start && (offset === 0 || isPhraseStart.has(k - offset)); offset++) {
        const length = sharedRun(tokens, start + offset, k)
        if (length >= minMatchWords) {
          restart = { index: k - offset, length: length + offset }
          break
        }
      }
    }
    if (!restart) continue
    const kept = tokens[restart.index]
    if (!kept) continue
    const previous = candidates.at(-1)
    if (previous && previous.endMs === first.word.startMs) {
      candidates[candidates.length - 1] = {
        ...previous,
        endMs: kept.word.startMs,
        abandonedText: `${previous.abandonedText} ${textOf(tokens, start, restart.index)}`,
        keptText: textOf(tokens, restart.index, restart.index + restart.length),
        matchedWords: restart.length,
      }
      coveredUntil = restart.index
      continue
    }
    candidates.push({
      startMs: first.word.startMs,
      endMs: kept.word.startMs,
      abandonedText: textOf(tokens, start, restart.index),
      keptText: textOf(tokens, restart.index, restart.index + restart.length),
      matchedWords: restart.length,
    })
    coveredUntil = restart.index
  }
  return candidates
}
