'use client'

import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import { AgentTrace } from '@/components/agent-trace'
import { HeroCallout } from '@/components/hero-callout'
import { handOff, type ReplayPhase, type TraceMode } from '@/lib/agent-replay'
import { AGENT_SCRIPT, LEAD_IN_MS } from '@/lib/agent-script'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { readEmbedMessage, type EmbedResult, type ParentMessage } from '@/lib/embed-protocol'
import { FRAME_PAD, centeredScrollTop, heroGeometry, measureWrapper, sameMetrics, type HeroMetrics } from '@/lib/hero-geometry'
import { cn } from '@/lib/utils'

const GUTTER_WIDTH = '15rem'

type Phase = 'poster' | 'loading' | 'slow' | 'fading' | 'live'

interface HeroState {
  phase: Phase
  autoplay: boolean
  expanded: boolean
  playing: boolean
  userPaused: boolean
  reducedMotion: boolean
  metrics: HeroMetrics | null
  replay: ReplayPhase
  results: ReadonlyMap<string, unknown>
}

const INITIAL_STATE: HeroState = {
  phase: 'poster',
  autoplay: false,
  expanded: false,
  playing: false,
  userPaused: false,
  reducedMotion: false,
  metrics: null,
  replay: { kind: 'waiting' },
  results: new Map(),
}
const VISIBLE_RATIO = 0.25
const POSTER_FADE_MS = 600
const READY_TIMEOUT_MS = 8000
const SCROLL_COLLAPSE_PX = 48
const SCROLL_ARM_MS = 700
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const AUTOPLAY_WIDTH_QUERY = '(min-width: 640px)'
const MOTION = 'duration-[600ms] ease-out-expo motion-reduce:transition-none'

const isReady = (phase: Phase): boolean => phase === 'fading' || phase === 'live'
const traceMode = (phase: Phase): TraceMode => (isReady(phase) ? 'live' : 'recorded')

function cssVariables(variables: Record<`--${string}`, string>): CSSProperties {
  return variables
}

function savesData(): boolean {
  const nav: unknown = navigator
  if (typeof nav !== 'object' || nav === null || !('connection' in nav)) return false
  const { connection } = nav
  return typeof connection === 'object' && connection !== null && 'saveData' in connection && connection.saveData === true
}

function canAutoplay(reducedMotion: boolean): boolean {
  return !reducedMotion && window.matchMedia(AUTOPLAY_WIDTH_QUERY).matches && !savesData()
}

function createHeroEmbed() {
  let state = INITIAL_STATE
  let frame: HTMLIFrameElement | null = null
  let wrapper: HTMLDivElement | null = null
  let visible = false
  let armed = false
  let armTimer = 0
  let readyTimer = 0
  let scriptTimer = 0
  const listeners = new Set<() => void>()

  const update = (patch: Partial<HeroState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const post = (message: ParentMessage) => {
    frame?.contentWindow?.postMessage(message, window.location.origin)
  }

  const resume = () => {
    if (isReady(state.phase) && visible && !document.hidden && !state.userPaused) post({ type: 'mcut:embed:play' })
  }

  const measure = () => {
    if (wrapper === null) return
    const metrics = measureWrapper(wrapper)
    if (!sameMetrics(state.metrics, metrics)) update({ metrics })
  }

  const schedule = (delayMs: number, run: () => void) => {
    window.clearTimeout(scriptTimer)
    scriptTimer = window.setTimeout(run, delayMs)
  }

  const send = (step: number) => {
    if (step >= AGENT_SCRIPT.length) {
      update({ replay: { kind: 'done' } })
      return
    }
    update({ replay: { kind: 'running', step } })
    post({ type: 'mcut:embed:request', request: AGENT_SCRIPT[step].request })
  }

  const startLoading = (patch: Partial<HeroState>) => {
    update({ ...patch, phase: 'loading' })
    window.clearTimeout(readyTimer)
    readyTimer = window.setTimeout(() => {
      if (state.phase === 'loading') update({ phase: 'slow' })
    }, READY_TIMEOUT_MS)
  }

  const onReady = () => {
    window.clearTimeout(readyTimer)
    post({ type: 'mcut:embed:collapsed', collapsed: !state.expanded })
    if (!visible || document.hidden) post({ type: 'mcut:embed:pause' })
    update({ phase: 'fading' })
    window.setTimeout(() => update({ phase: 'live' }), POSTER_FADE_MS)
    if (state.replay.kind === 'waiting' && !state.reducedMotion) schedule(LEAD_IN_MS, () => send(0))
  }

  const onResult = (message: EmbedResult) => {
    const { replay } = state
    if (replay.kind !== 'running' || AGENT_SCRIPT[replay.step].id !== message.id) return
    if (!message.ok) {
      update({ replay: { kind: 'failed', step: replay.step, message: message.message } })
      return
    }
    update({ results: new Map(state.results).set(message.id, message.result), replay: { kind: 'holding', step: replay.step } })
    schedule(AGENT_SCRIPT[replay.step].holdMs, () => send(replay.step + 1))
  }

  const onMessage = (event: MessageEvent) => {
    if (frame === null || event.origin !== window.location.origin || event.source !== frame.contentWindow) return
    const message = readEmbedMessage(event.data)
    if (message === null) return
    switch (message.type) {
      case 'mcut:embed:ready':
        onReady()
        return
      case 'mcut:embed:playing':
        update({ playing: message.playing, userPaused: !message.playing && visible && !document.hidden })
        return
      case 'mcut:embed:result':
        onResult(message)
        return
      default: {
        const unhandled: never = message
        throw new Error(`Unhandled embed message ${JSON.stringify(unhandled)}`)
      }
    }
  }

  const setVisible = (next: boolean) => {
    if (next === visible) return
    visible = next
    if (visible) resume()
    else post({ type: 'mcut:embed:pause' })
  }

  const onVisibility = () => {
    if (document.hidden) post({ type: 'mcut:embed:pause' })
    else resume()
  }

  const collapse = () => {
    update({ expanded: false })
    post({ type: 'mcut:embed:collapsed', collapsed: true })
    scrollTo(scrollTarget(false))
  }

  const scrollTarget = (expanded: boolean) => {
    const geometry = heroGeometry({ metrics: state.metrics, expanded })
    return state.metrics === null || geometry === null ? 0 : centeredScrollTop(state.metrics, geometry.wrapperHeight)
  }

  const scrollTo = (top: number) => window.scrollTo({ top, behavior: state.reducedMotion ? 'auto' : 'smooth' })

  const arm = () => {
    window.clearTimeout(armTimer)
    armed = true
  }

  const expand = () => {
    measure()
    window.clearTimeout(scriptTimer)
    const replay = handOff(state.replay)
    if (state.phase === 'poster') startLoading({ expanded: true, autoplay: false, replay })
    else update({ expanded: true, replay })
    post({ type: 'mcut:embed:collapsed', collapsed: false })
    armed = false
    window.clearTimeout(armTimer)
    armTimer = window.setTimeout(arm, SCROLL_ARM_MS)
    scrollTo(scrollTarget(true))
  }

  const load = () => startLoading({ autoplay: true })

  const run = () => send(0)

  const replay = () => {
    window.clearTimeout(scriptTimer)
    if (state.expanded) collapse()
    update({ results: new Map(), replay: { kind: 'waiting' } })
    post({ type: 'mcut:embed:reset' })
    if (isReady(state.phase)) schedule(LEAD_IN_MS, () => send(0))
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.expanded) collapse()
  }

  const onScroll = () => {
    if (!state.expanded) return
    const offset = Math.abs(window.scrollY - scrollTarget(true))
    if (!armed) {
      if (offset <= 1) arm()
      return
    }
    if (offset > SCROLL_COLLAPSE_PX) collapse()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches
    if (state.reducedMotion !== reducedMotion) update({ reducedMotion })
    if (state.phase === 'poster' && canAutoplay(reducedMotion)) startLoading({ autoplay: true })
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      listeners.delete(listener)
      window.clearTimeout(armTimer)
      window.clearTimeout(scriptTimer)
      window.clearTimeout(readyTimer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  const attachContainer = (node: HTMLDivElement | null) => {
    if (node === null) return
    wrapper = node
    measure()
    const intersection = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry) setVisible(entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO)
      },
      { threshold: [0, VISIBLE_RATIO] },
    )
    intersection.observe(node)
    const resize = new ResizeObserver(measure)
    resize.observe(node)
    return () => {
      intersection.disconnect()
      resize.disconnect()
      wrapper = null
    }
  }

  const attachFrame = (node: HTMLIFrameElement | null) => {
    frame = node
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL_STATE,
    subscribe,
    attachContainer,
    attachFrame,
    expand,
    collapse,
    load,
    run,
    replay,
  }
}

export function HeroDemo({ clip }: { clip: typeof DEMO_CLIP }) {
  const [{ subscribe, getSnapshot, getServerSnapshot, attachContainer, attachFrame, expand, collapse, load, run, replay }] = useState(createHeroEmbed)
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const geometry = heroGeometry(state)
  const src = `/embed?clip=${encodeURIComponent(clip.url)}${state.autoplay ? '&autoplay=1' : ''}&muted=1`
  const awaitingRun = isReady(state.phase) && state.reducedMotion && state.replay.kind === 'waiting'

  return (
    <>
      <div
        aria-hidden
        onClick={collapse}
        className={cn('fixed inset-0 z-10 bg-overlay/50 transition-opacity', MOTION, state.expanded ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <div className="grid gap-6 xl:grid-cols-[var(--gutter)_minmax(0,1fr)_var(--gutter)]" style={cssVariables({ '--gutter': GUTTER_WIDTH })}>
        <div className="order-2 xl:order-1">
          <AgentTrace
            steps={AGENT_SCRIPT}
            phase={state.replay}
            mode={traceMode(state.phase)}
            results={state.results}
            onReplay={replay}
            onLoad={state.phase === 'poster' ? load : null}
            onRun={awaitingRun ? run : null}
          />
        </div>
        <div className="order-1 flex min-w-0 flex-col xl:order-2">
          <div
            ref={attachContainer}
            className={cn('relative z-20 transition-[height]', MOTION, geometry === null && 'aspect-video w-full')}
            style={geometry === null ? undefined : { height: geometry.wrapperHeight }}
          >
            <div
              key={geometry === null ? 'placeholder' : 'frame'}
              className={cn(
                'absolute top-0 left-0 rounded-xl shadow-[0_24px_64px_-24px] shadow-overlay/45 will-change-transform transition-[width,height,transform,box-shadow]',
                MOTION,
                geometry === null && 'size-full',
              )}
              style={
                geometry === null
                  ? undefined
                  : { width: geometry.frameWidth, height: geometry.frameHeight, transform: `translateX(${geometry.frameTranslateX}px)` }
              }
            >
              <div
                className={cn(
                  'absolute origin-top-left overflow-hidden rounded-xl bg-neutral-950 will-change-transform transition-transform',
                  MOTION,
                  geometry === null && 'inset-0',
                )}
                style={
                  geometry === null
                    ? undefined
                    : { top: FRAME_PAD, left: FRAME_PAD, width: geometry.stageWidth, height: geometry.stageHeight, transform: `scale(${geometry.scale})` }
                }
              >
                {state.phase !== 'poster' && (
                  <iframe
                    ref={attachFrame}
                    src={src}
                    title="mcut Studio"
                    allow="autoplay; fullscreen"
                    allowFullScreen
                    className={cn(
                      'absolute top-0 left-0 border-0 transition-[opacity,filter] duration-700 ease-out motion-reduce:transition-none',
                      isReady(state.phase) ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
                      geometry === null && 'size-full',
                    )}
                    style={geometry === null ? undefined : { width: geometry.stageWidth, height: geometry.stageHeight }}
                  />
                )}
                {!state.expanded && (
                  <button type="button" aria-label="Take over the editor" className="absolute inset-0 z-10 cursor-pointer" onClick={expand} />
                )}
              </div>
            </div>
            {state.phase === 'poster' && (
              <img
                src={clip.poster}
                alt=""
                width={clip.width}
                height={clip.height}
                fetchPriority="high"
                decoding="async"
                className={cn(
                  'pointer-events-none absolute rounded-xl object-cover transition-[top,left,width,height] sm:hidden',
                  MOTION,
                  geometry === null && 'inset-0 size-full',
                )}
                style={
                  geometry === null
                    ? undefined
                    : {
                        top: FRAME_PAD,
                        left: FRAME_PAD + geometry.frameTranslateX,
                        width: geometry.stageWidth * geometry.scale,
                        height: geometry.stageHeight * geometry.scale,
                      }
                }
              />
            )}
          </div>
        </div>
        <HeroCallout hidden={state.expanded} className="order-3" />
      </div>
    </>
  )
}
