/**
 * Numeric helpers shared across editor panels and drag controllers. Pure
 * functions only — anything tied to timeline semantics (snapping, timecode)
 * lives in its own module.
 */

/** Clamps `value` to `[min, max]`; either bound may be omitted. */
export function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

/** Clamps `value` to the unit interval `[0, 1]`. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
