import { z } from 'zod'

/**
 * Per-range text formatting: a text element's `runs` are style OVERRIDES
 * over its base `style`, addressed by character offsets into `text`
 * ([start, end), like every rich-text run model). Only metrics-stable
 * properties can vary per run — font size and family stay element-global,
 * which keeps line height uniform and the layout engine simple. The
 * compositor slices lines at run boundaries and measures/paints each
 * segment with its own font string.
 *
 * The helpers here are pure and total: the inline editor calls
 * {@link shiftRunsForEdit} on every keystroke and {@link applyRunStyle}
 * from its selection toolbar, and serialization just stores the array.
 */

export const textRunStyleSchema = z.object({
  /** Any CSS color; overrides the base fill for the range. */
  color: z.string().optional(),
  fontWeight: z.number().int().min(100).max(1000).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
})

export const textRunSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    style: textRunStyleSchema,
  })
  .refine((run) => run.end > run.start, 'run end must be after its start')

export type TextRunStyle = z.infer<typeof textRunStyleSchema>
export type TextRun = z.infer<typeof textRunSchema>

const STYLE_KEYS = ['color', 'fontWeight', 'fontStyle'] as const

function stylesEqual(a: TextRunStyle, b: TextRunStyle): boolean {
  return STYLE_KEYS.every((key) => a[key] === b[key])
}

function isEmptyStyle(style: TextRunStyle): boolean {
  return STYLE_KEYS.every((key) => style[key] === undefined)
}

/**
 * Canonical form: clamped to the text, sorted, no empty ranges or styles,
 * adjacent equal-style runs merged. All helpers return normalized runs.
 */
export function normalizeRuns(runs: readonly TextRun[], textLength: number): TextRun[] {
  const clamped = runs
    .map((run) => ({
      start: Math.max(0, Math.min(run.start, textLength)),
      end: Math.max(0, Math.min(run.end, textLength)),
      style: run.style,
    }))
    .filter((run) => run.end > run.start && !isEmptyStyle(run.style))
    .sort((a, b) => a.start - b.start)
  const merged: TextRun[] = []
  for (const run of clamped) {
    const last = merged[merged.length - 1]
    if (last && last.end === run.start && stylesEqual(last.style, run.style)) {
      last.end = run.end
    } else {
      merged.push({ ...run, style: { ...run.style } })
    }
  }
  return merged
}

/** The effective override style at a character offset ({} when none). */
export function getRunStyleAt(runs: readonly TextRun[], offset: number): TextRunStyle {
  for (const run of runs) {
    if (offset >= run.start && offset < run.end) return run.style
  }
  return {}
}

/** A property patch for {@link applyRunStyle}: `null` clears the override. */
export type TextRunStylePatch = {
  [K in keyof TextRunStyle]?: TextRunStyle[K] | null
}

/**
 * Apply a style patch over [start, end): existing overrides in the range
 * are merged with the patch (null entries clear), runs outside the range
 * are untouched, and partially-covered runs split at the boundaries.
 */
export function applyRunStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: TextRunStylePatch,
  textLength: number,
): TextRun[] {
  const from = Math.max(0, Math.min(start, textLength))
  const to = Math.max(from, Math.min(end, textLength))
  if (to <= from) return normalizeRuns(runs, textLength)

  // Slice the whole text at every boundary, then restyle the target range.
  const edges = new Set<number>([0, textLength, from, to])
  for (const run of runs) {
    edges.add(Math.min(run.start, textLength))
    edges.add(Math.min(run.end, textLength))
  }
  const sorted = [...edges].sort((a, b) => a - b)
  const next: TextRun[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (b <= a) continue
    const base = getRunStyleAt(runs, a)
    let style: TextRunStyle = base
    if (a >= from && b <= to) {
      style = { ...base }
      for (const key of STYLE_KEYS) {
        const value = patch[key]
        if (value === null) delete style[key]
        else if (value !== undefined) (style as Record<string, unknown>)[key] = value
      }
    }
    if (!isEmptyStyle(style)) next.push({ start: a, end: b, style })
  }
  return normalizeRuns(next, textLength)
}

/**
 * Remap runs across a text edit, given the before/after strings. The edit
 * region is recovered by common prefix/suffix; offsets after it shift,
 * offsets inside clamp to its bounds. Typing INSIDE a styled run grows the
 * run (the new characters inherit its style), which is what every rich
 * editor does.
 */
export function shiftRunsForEdit(
  runs: readonly TextRun[],
  oldText: string,
  newText: string,
): TextRun[] {
  if (oldText === newText) return normalizeRuns(runs, newText.length)
  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++
  let suffix = 0
  const maxSuffix = Math.min(oldText.length, newText.length) - prefix
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++
  }
  const oldEditEnd = oldText.length - suffix
  const insertedLength = newText.length - suffix - prefix
  const delta = newText.length - oldText.length

  const mapOffset = (offset: number, isEnd: boolean): number => {
    if (offset <= prefix) {
      // A pure insertion exactly at a run boundary: the run ENDING there
      // absorbs it (typing at the end of a bold word keeps typing bold)
      // and the run STARTING there shifts right — so they never overlap.
      if (offset === prefix && insertedLength > 0 && oldEditEnd === prefix) {
        return isEnd ? offset + insertedLength : offset + (offset === 0 ? 0 : insertedLength)
      }
      return offset
    }
    if (offset >= oldEditEnd) return offset + delta
    // Inside the replaced region: clamp to the edit bounds.
    return isEnd ? prefix + Math.max(0, insertedLength) : prefix
  }

  return normalizeRuns(
    runs.map((run) => ({
      start: mapOffset(run.start, false),
      end: mapOffset(run.end, true),
      style: run.style,
    })),
    newText.length,
  )
}
