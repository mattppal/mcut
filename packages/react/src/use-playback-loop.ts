'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { getProjectDurationMs, type EditorEngine, type PlaybackState, type Project } from '@mcut/timeline'

export type RequestFrame = (callback: (frameTimeMs: number) => void) => () => void

export type PlaybackClock = (frameTimeMs: number) => number | null

export interface PlaybackLoopOptions {
  onFrame: (project: Project, playback: PlaybackState) => void
  requestFrame?: RequestFrame
  clock?: PlaybackClock
}

const requestAnimationFrameOnce: RequestFrame = (callback) => {
  const handle = requestAnimationFrame(callback)
  return () => cancelAnimationFrame(handle)
}

export function usePlaybackLoop(engine: EditorEngine, { onFrame, requestFrame = requestAnimationFrameOnce, clock }: PlaybackLoopOptions): void {
  const onFrameRef = useRef(onFrame)
  const clockRef = useRef(clock)
  useLayoutEffect(() => {
    onFrameRef.current = onFrame
    clockRef.current = clock
  })

  useEffect(() => {
    let previousFrameMs: number | null = null
    let cancel = () => {}
    const tick = (frameTimeMs: number) => {
      const elapsedMs = previousFrameMs === null ? 0 : frameTimeMs - previousFrameMs
      previousFrameMs = frameTimeMs
      const playback = engine.playback.state
      if (playback.isPlaying) {
        const durationMs = getProjectDurationMs(engine.project)
        const next = clockRef.current?.(frameTimeMs) ?? playback.currentTimeMs + elapsedMs * playback.playbackRate
        if (durationMs > 0 && next >= durationMs && playback.playbackRate > 0) {
          engine.seek(durationMs)
          engine.pause()
        } else if (next <= 0 && playback.playbackRate < 0) {
          engine.seek(0)
          engine.pause()
        } else {
          engine.seek(next)
        }
      }
      onFrameRef.current(engine.project, engine.playback.state)
      cancel = requestFrame(tick)
    }
    cancel = requestFrame(tick)
    return () => cancel()
  }, [engine, requestFrame])
}
