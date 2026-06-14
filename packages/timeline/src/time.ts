/**
 * Timebase: mcut stores all times as INTEGER MILLISECONDS, not frames.
 *
 * This is a deliberate contract. At common frame rates a frame is not a whole
 * number of milliseconds (33.3̅ms at 30fps), so element boundaries do not in
 * general sit exactly on the frame grid. Export is still deterministic — it
 * iterates by frame index and samples the project at `frameToMs(i, fps)` —
 * but frame-exact NLE semantics (broadcast 29.97/23.976 workflows) are out of
 * scope; that would require a rational-ticks timebase and is intentionally
 * not pursued.
 *
 * Editing surfaces that want cuts on frame boundaries (split-at-playhead,
 * frame stepping) should quantize through these helpers before dispatching.
 */

/** Duration of one frame in (fractional) milliseconds. */
export function msPerFrame(fps: number): number {
  return 1000 / fps
}

/** The frame index containing `timeMs` (rounded to the nearest boundary). */
export function msToFrame(timeMs: number, fps: number): number {
  return Math.round((timeMs * fps) / 1000)
}

/** Integer-ms timestamp of frame `frame` (what export samples). */
export function frameToMs(frame: number, fps: number): number {
  return Math.round((frame * 1000) / fps)
}

/**
 * Snap a timestamp to the nearest frame boundary, in integer ms.
 * `quantizeMsToFrame(t, fps)` is idempotent up to ±1ms rounding.
 */
export function quantizeMsToFrame(timeMs: number, fps: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  const frames = (timeMs * fps) / 1000
  const frame = mode === 'floor' ? Math.floor(frames) : mode === 'ceil' ? Math.ceil(frames) : Math.round(frames)
  return frameToMs(frame, fps)
}
