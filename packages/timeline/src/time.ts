export function msPerFrame(fps: number): number {
  return 1000 / fps
}

export function msToFrame(timeMs: number, fps: number): number {
  return Math.round((timeMs * fps) / 1000)
}

export function frameToMs(frame: number, fps: number): number {
  return Math.round((frame * 1000) / fps)
}

export function quantizeMsToFrame(timeMs: number, fps: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  const frames = (timeMs * fps) / 1000
  const frame = mode === 'floor' ? Math.floor(frames) : mode === 'ceil' ? Math.ceil(frames) : Math.round(frames)
  return frameToMs(frame, fps)
}
