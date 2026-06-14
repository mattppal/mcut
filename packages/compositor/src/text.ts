import { getRunStyleAt, type CaptionStyle, type TextBox, type TextRun, type TextRunStyle, type TextStyle } from '@mcut/timeline'

/**
 * Width of `text` drawn with `font` and `letterSpacingPx` of tracking.
 * Implementations should set `ctx.letterSpacing` when the engine supports it
 * so measurement matches drawing; engines without it ignore the parameter
 * (and the renderer draws without tracking — consistent both ways).
 */
export type MeasureFn = (text: string, font: string, letterSpacingPx?: number) => number

export function buildFont(style: {
  fontStyle?: 'normal' | 'italic'
  fontWeight: number
  fontSize: number
  fontFamily: string
}): string {
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

/**
 * Quote a single family name for the canvas font shorthand ("Bebas Neue"
 * breaks the parse unquoted). Generic keywords and pre-built stacks
 * (commas/quotes) pass through untouched.
 */
function quoteFamily(family: string): string {
  const trimmed = family.trim()
  if (GENERIC_FAMILIES.has(trimmed) || /[,"']/.test(trimmed)) return trimmed
  return `"${trimmed}"`
}

/** Render-time case transform; the stored text keeps the user's casing. */
export function applyTextTransform(text: string, transform: TextStyle['textTransform']): string {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  return text
}

/** One same-style stretch of a visual line (rich-text runs; see rich-text.ts). */
export interface TextSegment {
  /** Case-transformed slice, ready to paint. */
  text: string
  width: number
  font: string
  /** Fill override from the segment's run (base style color otherwise). */
  color?: string
}

export interface TextBlockLayout {
  /** `segments` present only when the element has style runs. */
  lines: { text: string; width: number; segments?: TextSegment[] }[]
  font: string
  lineHeight: number
  padding: number
  overflow: TextBox['overflow'] | null
  /** Box size including padding — matches what the renderer draws. */
  width: number
  height: number
}

export interface TextBlockOptions {
  box?: TextBox
  /** Per-range style overrides (character offsets into the text). */
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

/**
 * Slice [from, to) of the SOURCE text into measured segments, splitting at
 * run boundaries. Case transform applies per segment (after slicing), so
 * run offsets stay valid even for case-changing transforms.
 */
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
  const edges = new Set<number>([from, to])
  for (const run of runs) {
    if (run.start > from && run.start < to) edges.add(run.start)
    if (run.end > from && run.end < to) edges.add(run.end)
  }
  const sorted = [...edges].sort((a, b) => a - b)
  const segments: TextSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const run = getRunStyleAt(runs, a)
    const font = segmentFont(style, run)
    const segText = applyTextTransform(text.slice(a, b), style.textTransform ?? 'none')
    segments.push({
      text: segText,
      width: measure(segText, font, letterSpacing),
      font,
      ...(run.color !== undefined ? { color: run.color } : {}),
    })
  }
  return segments
}

/** Sum of segment widths over a source range (wrap candidate measure). */
function rangeWidth(
  measure: MeasureFn,
  text: string,
  style: TextStyle,
  runs: readonly TextRun[],
  from: number,
  to: number,
  letterSpacing: number,
): number {
  let width = 0
  for (const seg of sliceSegments(measure, text, style, runs, from, to, letterSpacing)) {
    width += seg.width
  }
  return width
}

function wrapLine(
  measure: MeasureFn,
  font: string,
  line: string,
  maxWidth: number,
  letterSpacing: number,
): { text: string; width: number }[] {
  const words = line.match(/\S+/g)
  if (!words || words.length === 0) return [{ text: '', width: 0 }]

  const lines: { text: string; width: number }[] = []
  let current = words[0]!
  let currentWidth = measure(current, font, letterSpacing)

  for (const word of words.slice(1)) {
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

/**
 * Run-aware layout: lines slice at run boundaries into measured segments.
 * Font size is element-global (runs vary only color/weight/italic), so line
 * metrics stay uniform; only widths differ per segment.
 */
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
    // Greedy word wrap by source offsets, measuring candidate ranges
    // segment-by-segment so mixed weights wrap where they truly fit.
    const lineText = text.slice(source.start, source.end)
    const words: Array<{ start: number; end: number }> = []
    const matcher = /\S+/g
    for (let m = matcher.exec(lineText); m; m = matcher.exec(lineText)) {
      words.push({ start: source.start + m.index, end: source.start + m.index + m[0].length })
    }
    if (words.length === 0) {
      finishLine(source.start, source.start)
      continue
    }
    let visualStart = words[0]!.start
    let lastEnd = words[0]!.end
    for (const word of words.slice(1)) {
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

/**
 * Lay out a (possibly multi-line) text element. Lines come from explicit
 * newlines only unless a text box width is provided.
 */
export function layoutTextBlock(
  measure: MeasureFn,
  text: string,
  style: TextStyle,
  options: TextBlockOptions = {},
): TextBlockLayout {
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
          innerBoxWidth
            ? wrapLine(measure, font, line, innerBoxWidth, letterSpacing)
            : [{ text: line, width: measure(line, font, letterSpacing) }],
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
  /** X offset from the line's left edge. */
  x: number
  width: number
  /** Word timing relative to the element start, when known. */
  startMs?: number
  endMs?: number
}

export interface CaptionLayout {
  lines: { words: CaptionWordBox[]; width: number }[]
  font: string
  lineHeight: number
  spaceWidth: number
}

/**
 * Greedily wrap caption words into centered lines no wider than `maxWidth`.
 * Falls back to whitespace-split text when word timings are absent.
 */
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
