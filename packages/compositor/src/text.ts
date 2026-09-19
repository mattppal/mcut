import { getRunStyleAt, type CaptionStyle, type TextBox, type TextRun, type TextRunStyle, type TextStyle } from '@mcut/timeline'

export type MeasureFn = (text: string, font: string, letterSpacingPx?: number) => number

export function buildFont(style: { fontStyle?: 'normal' | 'italic'; fontWeight: number; fontSize: number; fontFamily: string }): string {
  const fontStyle = style.fontStyle === 'italic' ? 'italic ' : ''
  const family = quoteFamily(style.fontFamily)
  return `${fontStyle}${style.fontWeight} ${style.fontSize}px ${family}`
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

function quoteFamily(family: string): string {
  const trimmed = family.trim()
  if (GENERIC_FAMILIES.has(trimmed) || /[,"']/.test(trimmed)) return trimmed
  return `"${trimmed}"`
}

export function applyTextTransform(text: string, transform: TextStyle['textTransform']): string {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  return text
}

export interface TextSegment {
  text: string
  width: number
  font: string
  color?: string
}

export interface TextBlockLayout {
  lines: { text: string; width: number; segments?: TextSegment[] }[]
  font: string
  lineHeight: number
  padding: number
  overflow: TextBox['overflow'] | null
  width: number
  height: number
}

export interface TextBlockOptions {
  box?: TextBox
  runs?: readonly TextRun[]
}

function segmentFont(style: TextStyle, run: TextRunStyle): string {
  return buildFont({
    fontStyle: run.fontStyle ?? style.fontStyle ?? 'normal',
    fontWeight: run.fontWeight ?? style.fontWeight,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
  })
}

function sliceSegments(
  measure: MeasureFn,
  text: string,
  style: TextStyle,
  runs: readonly TextRun[],
  from: number,
  to: number,
  letterSpacing: number,
): TextSegment[] {
  if (to <= from) return []
  const innerEdges = new Set<number>()
  for (const run of runs) {
    if (run.start > from && run.start < to) innerEdges.add(run.start)
    if (run.end > from && run.end < to) innerEdges.add(run.end)
  }
  const segments: TextSegment[] = []
  let a = from
  for (const b of [...innerEdges, to].sort((x, y) => x - y)) {
    const run = getRunStyleAt(runs, a)
    const font = segmentFont(style, run)
    const segText = applyTextTransform(text.slice(a, b), style.textTransform ?? 'none')
    segments.push({
      text: segText,
      width: measure(segText, font, letterSpacing),
      font,
      ...(run.color !== undefined ? { color: run.color } : {}),
    })
    a = b
  }
  return segments
}

function rangeWidth(measure: MeasureFn, text: string, style: TextStyle, runs: readonly TextRun[], from: number, to: number, letterSpacing: number): number {
  let width = 0
  for (const seg of sliceSegments(measure, text, style, runs, from, to, letterSpacing)) {
    width += seg.width
  }
  return width
}

function wrapLine(measure: MeasureFn, font: string, line: string, maxWidth: number, letterSpacing: number): { text: string; width: number }[] {
  const [firstWord, ...restWords] = line.match(/\S+/g) ?? []
  if (firstWord === undefined) return [{ text: '', width: 0 }]

  const lines: { text: string; width: number }[] = []
  let current = firstWord
  let currentWidth = measure(current, font, letterSpacing)

  for (const word of restWords) {
    const candidate = `${current} ${word}`
    const candidateWidth = measure(candidate, font, letterSpacing)
    if (candidateWidth <= maxWidth) {
      current = candidate
      currentWidth = candidateWidth
      continue
    }
    lines.push({ text: current, width: currentWidth })
    current = word
    currentWidth = measure(current, font, letterSpacing)
  }

  lines.push({ text: current, width: currentWidth })
  return lines
}

function layoutRunLines(
  measure: MeasureFn,
  text: string,
  style: TextStyle,
  runs: readonly TextRun[],
  innerBoxWidth: number | null,
  letterSpacing: number,
): { text: string; width: number; segments: TextSegment[] }[] {
  const lines: { text: string; width: number; segments: TextSegment[] }[] = []
  const finishLine = (from: number, to: number) => {
    const segments = sliceSegments(measure, text, style, runs, from, to, letterSpacing)
    lines.push({
      text: segments.map((seg) => seg.text).join(''),
      width: segments.reduce((sum, seg) => sum + seg.width, 0),
      segments,
    })
  }

  let lineStart = 0
  const sourceLines: Array<{ start: number; end: number }> = []
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      sourceLines.push({ start: lineStart, end: i })
      lineStart = i + 1
    }
  }

  for (const source of sourceLines) {
    if (!innerBoxWidth) {
      finishLine(source.start, source.end)
      continue
    }
    const lineText = text.slice(source.start, source.end)
    const words: Array<{ start: number; end: number }> = []
    const matcher = /\S+/g
    for (let m = matcher.exec(lineText); m; m = matcher.exec(lineText)) {
      words.push({ start: source.start + m.index, end: source.start + m.index + m[0].length })
    }
    const [firstWord, ...restWords] = words
    if (!firstWord) {
      finishLine(source.start, source.start)
      continue
    }
    let visualStart = firstWord.start
    let lastEnd = firstWord.end
    for (const word of restWords) {
      const candidate = rangeWidth(measure, text, style, runs, visualStart, word.end, letterSpacing)
      if (candidate <= innerBoxWidth) {
        lastEnd = word.end
        continue
      }
      finishLine(visualStart, lastEnd)
      visualStart = word.start
      lastEnd = word.end
    }
    finishLine(visualStart, lastEnd)
  }
  return lines
}

export function layoutTextBlock(measure: MeasureFn, text: string, style: TextStyle, options: TextBlockOptions = {}): TextBlockLayout {
  const font = buildFont(style)
  const letterSpacing = style.letterSpacing ?? 0
  const lineHeight = style.fontSize * (style.lineHeight ?? 1.25)
  const padding = style.backgroundColor ? style.fontSize * 0.25 : 0
  const box = options.box
  const innerBoxWidth = box ? Math.max(1, box.width - padding * 2) : null
  const runs = options.runs && options.runs.length > 0 ? options.runs : null
  const lines = runs
    ? layoutRunLines(measure, text, style, runs, innerBoxWidth, letterSpacing)
    : applyTextTransform(text, style.textTransform ?? 'none')
        .split('\n')
        .flatMap((line) =>
          innerBoxWidth ? wrapLine(measure, font, line, innerBoxWidth, letterSpacing) : [{ text: line, width: measure(line, font, letterSpacing) }],
        )
  const maxLineWidth = Math.max(0, ...lines.map((l) => l.width))
  const autoHeight = lines.length * lineHeight + padding * 2
  return {
    lines,
    font,
    lineHeight,
    padding,
    overflow: box?.overflow ?? null,
    width: box ? box.width : maxLineWidth + padding * 2,
    height: box?.height ?? autoHeight,
  }
}

export interface CaptionWordBox {
  text: string
  x: number
  width: number
  startMs?: number
  endMs?: number
}

export interface CaptionLayout {
  lines: { words: CaptionWordBox[]; width: number }[]
  font: string
  lineHeight: number
  spaceWidth: number
}

export function layoutCaption(
  measure: MeasureFn,
  element: { text: string; words?: { text: string; startMs: number; endMs: number }[] },
  style: CaptionStyle,
  maxWidth: number,
): CaptionLayout {
  const font = buildFont(style)
  const lineHeight = style.fontSize * 1.3
  const spaceWidth = measure(' ', font)
  const words =
    element.words && element.words.length > 0
      ? element.words
      : element.text
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text, startMs: undefined, endMs: undefined }))

  const lines: { words: CaptionWordBox[]; width: number }[] = []
  let current: CaptionWordBox[] = []
  let currentWidth = 0

  for (const word of words) {
    const width = measure(word.text, font)
    const widthWithSpace = current.length === 0 ? width : currentWidth + spaceWidth + width
    if (current.length > 0 && widthWithSpace > maxWidth) {
      lines.push({ words: current, width: currentWidth })
      current = []
      currentWidth = 0
    }
    const x = current.length === 0 ? 0 : currentWidth + spaceWidth
    current.push({ text: word.text, x, width, startMs: word.startMs, endMs: word.endMs })
    currentWidth = x + width
  }
  if (current.length > 0) lines.push({ words: current, width: currentWidth })

  return { lines, font, lineHeight, spaceWidth }
}
