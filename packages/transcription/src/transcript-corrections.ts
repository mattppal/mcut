import type { CaptionWord } from '@mcut/timeline'
import {
  buildMatch,
  distributeTokens,
  mapCaptionWords,
  mergeCaptions,
  patchMatches,
  splitCaptionAtWord,
  type CaptionContentPatch,
  type TranscriptCaption,
  type TranscriptMatch,
} from './transcript-tools'

export interface CaptionCorrectionPatch extends CaptionContentPatch {
  startMs: number
  durationMs: number
}

export interface TranscriptCorrection {
  patches: CaptionCorrectionPatch[]
  removedIds: string[]
  count: number
}

function wholeWordPattern(find: string): RegExp | null {
  const tokens = find.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const body = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`\s+`)
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'giu')
}

function spansOf(text: string, needle: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) spans.push([at, at + needle.length])
  return spans
}

function wholeWordMatches(caption: TranscriptCaption, pattern: RegExp, replacement: string): TranscriptMatch[] {
  const mapped = mapCaptionWords(caption)
  const corrected = spansOf(caption.text, replacement)
  return [...caption.text.matchAll(pattern)]
    .map((hit): [number, number] => [hit.index, hit.index + hit[0].length])
    .filter(([start, end]) => !corrected.some(([from, to]) => from <= start && end <= to))
    .map(([start, end]) => buildMatch(caption, mapped, start, end))
}

function acrossBoundary(
  a: TranscriptCaption,
  b: TranscriptCaption,
  pattern: RegExp,
  replacement: string,
): [TranscriptCaption, TranscriptCaption | null] | null {
  const boundary = mapCaptionWords(a)?.length ?? 0
  if (boundary === 0 || !mapCaptionWords(b)) return null
  const merged = mergeCaptions(a, b)
  const joined: TranscriptCaption = { ...a, startMs: merged.startMs, durationMs: merged.durationMs, text: merged.text, words: merged.words ?? [] }
  const cross = wholeWordMatches(joined, pattern, replacement).find(
    (match) => match.firstWord !== undefined && match.lastWord !== undefined && match.firstWord < boundary && match.lastWord >= boundary,
  )
  if (cross?.lastWord === undefined) return null
  const patch = patchMatches(joined, [cross], replacement)
  if (!patch.words) return null
  const corrected = { ...joined, text: patch.text, words: patch.words }
  const tail = (joined.words?.length ?? 0) - 1 - cross.lastWord
  const split = tail > 0 ? splitCaptionAtWord(corrected, patch.words.length - tail) : null
  if (!split) return [corrected, null]
  return [
    { ...a, text: split.left.text, words: split.left.words, durationMs: split.left.durationMs },
    { ...b, ...split.right },
  ]
}

export function correctCaptions(captions: readonly TranscriptCaption[], find: string, replace: string): TranscriptCorrection {
  const pattern = wholeWordPattern(find)
  const replacement = replace.trim()
  if (!pattern || replacement.length === 0) return { patches: [], removedIds: [], count: 0 }
  let count = 0
  const current = [...captions]
    .sort((x, y) => x.startMs - y.startMs)
    .map((caption) => {
      const matches = wholeWordMatches(caption, pattern, replacement)
      count += matches.length
      if (matches.length === 0) return caption
      const patch = patchMatches(caption, matches, replacement)
      return { ...caption, text: patch.text, words: patch.words ?? [] }
    })
  const removedIds: string[] = []
  for (let i = 0; i + 1 < current.length; i++) {
    const a = current[i]
    const b = current[i + 1]
    const joined = a && b ? acrossBoundary(a, b, pattern, replacement) : null
    if (!joined || !b) continue
    count += 1
    const [left, right] = joined
    current[i] = left
    if (right) {
      current[i + 1] = right
    } else {
      removedIds.push(b.id)
      current.splice(i + 1, 1)
      i -= 1
    }
  }
  const originals = new Map(captions.map((caption) => [caption.id, caption]))
  const patches = current
    .filter((caption) => originals.get(caption.id) !== caption)
    .sort((x, y) => y.startMs - x.startMs)
    .map(({ id, text, words, startMs, durationMs }) => ({ captionId: id, text, ...(words ? { words } : {}), startMs, durationMs }))
  return { patches, removedIds, count }
}

export function correctWords(words: readonly CaptionWord[], find: string, replace: string): { words: CaptionWord[]; count: number } {
  const caption: TranscriptCaption = { id: '', startMs: 0, durationMs: 0, text: words.map((word) => word.text).join(' '), words: [...words] }
  const { patches, count } = correctCaptions([caption], find, replace)
  return { words: patches[0]?.words ?? [...words], count }
}

export function retypeCaption(caption: TranscriptCaption, text: string): CaptionContentPatch {
  const old = mapCaptionWords(caption)?.map((mapped) => mapped.word)
  if (!old) return { captionId: caption.id, text }
  const tokens = text.split(/\s+/).filter(Boolean)
  let head = 0
  while (head < old.length && head < tokens.length && old[head]?.text === tokens[head]) head++
  let tail = 0
  while (tail < old.length - head && tail < tokens.length - head && old[old.length - 1 - tail]?.text === tokens[tokens.length - 1 - tail]) tail++
  let from = head
  let to = old.length - tail
  const typed = tokens.slice(head, tokens.length - tail)
  const inserted = from === to && typed.length > 0
  const lead = inserted ? old[from - 1] : undefined
  const trail = inserted && !lead ? old[to] : undefined
  if (lead) {
    from -= 1
    typed.unshift(lead.text)
  }
  if (trail) {
    to += 1
    typed.push(trail.text)
  }
  const first = old[from]
  const last = old[to - 1]
  const spanWords = first && last && from < to ? distributeTokens(typed, first.startMs, Math.max(first.startMs, last.endMs)) : []
  return { captionId: caption.id, text, words: [...old.slice(0, from), ...spanWords, ...old.slice(to)] }
}
