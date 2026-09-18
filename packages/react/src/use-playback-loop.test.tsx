import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

import { describe, expect, test } from 'bun:test'
import { EditorEngine } from '@mcut/timeline'
import { usePlaybackLoop, type RequestFrame } from './use-playback-loop'

const { renderHook } = await import('@testing-library/react')

function engineWithClip(durationMs: number): EditorEngine {
  const engine = new EditorEngine()
  engine.dispatch({ type: 'addTrack', id: 't-clips', name: 'Clips' })
  engine.dispatch({
    type: 'addElement',
    trackId: 't-clips',
    element: { type: 'text', id: 'e-clip', startMs: 0, durationMs, text: 'clip' },
  })
  return engine
}

function fakeFrames() {
  let pending: ((frameTimeMs: number) => void) | null = null
  const requestFrame: RequestFrame = (callback) => {
    pending = callback
    return () => {
      if (pending === callback) pending = null
    }
  }
  return {
    requestFrame,
    hasPending: () => pending !== null,
    step(frameTimeMs: number) {
      const callback = pending
      pending = null
      if (!callback) throw new Error('no frame requested')
      callback(frameTimeMs)
    },
  }
}

function mountLoop(engine: EditorEngine, onFrame: () => void = () => {}) {
  const frames = fakeFrames()
  const rendered = renderHook(() =>
    usePlaybackLoop(engine, { onFrame, requestFrame: frames.requestFrame }),
  )
  return { frames, ...rendered }
}

describe('usePlaybackLoop', () => {
  test('advances the playhead by the elapsed frame time while playing', () => {
    const engine = engineWithClip(10_000)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(1000)
    frames.step(1250)
    expect(engine.playback.state.currentTimeMs).toBe(250)
    frames.step(1500)
    expect(engine.playback.state.currentTimeMs).toBe(500)
  })

  test('scales the advance by the playback rate', () => {
    const engine = engineWithClip(10_000)
    engine.setPlaybackRate(2)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(100)
    expect(engine.playback.state.currentTimeMs).toBe(200)
  })

  test('pause stops the playhead where it is', () => {
    const engine = engineWithClip(10_000)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(100)
    engine.pause()
    frames.step(200)
    frames.step(300)
    expect(engine.playback.state.currentTimeMs).toBe(100)
  })

  test('seek sets the exact ms and playback resumes from there', () => {
    const engine = engineWithClip(10_000)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(100)
    engine.seek(4000)
    expect(engine.playback.state.currentTimeMs).toBe(4000)
    frames.step(150)
    expect(engine.playback.state.currentTimeMs).toBe(4050)
  })

  test('a paused seek holds its exact ms across frames', () => {
    const engine = engineWithClip(10_000)
    engine.seek(1234)
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(16)
    expect(engine.playback.state.currentTimeMs).toBe(1234)
  })

  test('stops at the project end and pauses', () => {
    const engine = engineWithClip(1000)
    engine.seek(900)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(200)
    expect(engine.playback.state).toMatchObject({ currentTimeMs: 1000, isPlaying: false })
  })

  test('a reverse shuttle stops at zero and pauses', () => {
    const engine = engineWithClip(1000)
    engine.seek(50)
    engine.setPlaybackRate(-1)
    engine.play()
    const { frames } = mountLoop(engine)
    frames.step(0)
    frames.step(100)
    expect(engine.playback.state).toMatchObject({ currentTimeMs: 0, isPlaying: false })
  })

  test('calls onFrame with the playback state after the advance', () => {
    const engine = engineWithClip(10_000)
    engine.play()
    const seen: number[] = []
    const frames = fakeFrames()
    renderHook(() =>
      usePlaybackLoop(engine, {
        onFrame: (_project, playback) => seen.push(playback.currentTimeMs),
        requestFrame: frames.requestFrame,
      }),
    )
    frames.step(0)
    frames.step(100)
    frames.step(160)
    expect(seen).toEqual([0, 100, 160])
  })

  test('a rerender swaps in the latest onFrame without restarting the clock', () => {
    const engine = engineWithClip(10_000)
    engine.play()
    const seen: string[] = []
    const frames = fakeFrames()
    const { rerender } = renderHook(
      ({ label }: { label: string }) =>
        usePlaybackLoop(engine, {
          onFrame: () => seen.push(label),
          requestFrame: frames.requestFrame,
        }),
      { initialProps: { label: 'first' } },
    )
    frames.step(0)
    rerender({ label: 'second' })
    frames.step(100)
    expect(seen).toEqual(['first', 'second'])
    expect(engine.playback.state.currentTimeMs).toBe(100)
  })

  test('unmount cancels the pending frame', () => {
    const engine = engineWithClip(10_000)
    const { frames, unmount } = mountLoop(engine)
    const pendingBefore = frames.hasPending()
    unmount()
    expect([pendingBefore, frames.hasPending()]).toEqual([true, false])
  })
})
