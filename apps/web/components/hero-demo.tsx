'use client'

import { useState, useSyncExternalStore } from 'react'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { readEmbedMessage, type ParentMessage } from '@/lib/embed-protocol'
import { cn } from '@/lib/utils'

type Phase = 'poster' | 'loading' | 'fading' | 'live'

interface HeroMetrics {
  viewportWidth: number
  viewportHeight: number
  containerWidth: number
  wrapperTop: number
}

interface HeroState {
  phase: Phase
  autoplay: boolean
  expanded: boolean
  playing: boolean
  userPaused: boolean
  metrics: HeroMetrics | null
}

interface HeroGeometry {
  stageWidth: number
  stageHeight: number
  scale: number
  frameWidth: number
  frameHeight: number
  frameTranslateX: number
  wrapperHeight: number
}

const INITIAL_STATE: HeroState = { phase: 'poster', autoplay: false, expanded: false, playing: false, userPaused: false, metrics: null }
const VISIBLE_RATIO = 0.25
const POSTER_FADE_MS = 400
const FRAME_PAD = 8
const VIEWPORT_PAD = 16
const SCROLL_COLLAPSE_PX = 48
const SCROLL_ARM_MS = 700
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const MOTION = 'duration-[600ms] ease-out-expo motion-reduce:transition-none'

function heroGeometry({ metrics, expanded }: HeroState): HeroGeometry | null {
  if (metrics === null) return null
  const availableWidth = metrics.viewportWidth - 2 * VIEWPORT_PAD - 2 * FRAME_PAD
  const availableHeight = metrics.viewportHeight - metrics.wrapperTop - VIEWPORT_PAD - 2 * FRAME_PAD
  const stageWidth = Math.floor(Math.min(availableWidth, (availableHeight * 16) / 9))
  const stageHeight = Math.round((stageWidth * 9) / 16)
  const scale = expanded ? 1 : (metrics.containerWidth - 2 * FRAME_PAD) / stageWidth
  const frameWidth = expanded ? stageWidth + 2 * FRAME_PAD : metrics.containerWidth
  const frameHeight = stageHeight * scale + 2 * FRAME_PAD
  const frameTranslateX = expanded ? (metrics.containerWidth - frameWidth) / 2 : 0
  return { stageWidth, stageHeight, scale, frameWidth, frameHeight, frameTranslateX, wrapperHeight: frameHeight }
}

function measureWrapper(wrapper: HTMLDivElement): HeroMetrics {
  const rect = wrapper.getBoundingClientRect()
  return {
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    containerWidth: rect.width,
    wrapperTop: rect.top + window.scrollY,
  }
}

function sameMetrics(a: HeroMetrics | null, b: HeroMetrics): boolean {
  return (
    a !== null &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.containerWidth === b.containerWidth &&
    a.wrapperTop === b.wrapperTop
  )
}

function createHeroEmbed() {
  let state = INITIAL_STATE
  let frame: HTMLIFrameElement | null = null
  let wrapper: HTMLDivElement | null = null
  let visible = false
  let armed = false
  let armTimer = 0
  const listeners = new Set<() => void>()

  const update = (patch: Partial<HeroState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const post = (message: ParentMessage) => {
    frame?.contentWindow?.postMessage(message, window.location.origin)
  }

  const resume = () => {
    const ready = state.phase === 'fading' || state.phase === 'live'
    if (ready && visible && !document.hidden && !state.userPaused) post({ type: 'mcut:embed:play' })
  }

  const measure = () => {
    if (wrapper === null) return
    const metrics = measureWrapper(wrapper)
    if (!sameMetrics(state.metrics, metrics)) update({ metrics })
  }

  const onMessage = (event: MessageEvent) => {
    if (frame === null || event.origin !== window.location.origin || event.source !== frame.contentWindow) return
    const message = readEmbedMessage(event.data)
    if (message === null) return
    if (message.type === 'mcut:embed:ready') {
      post({ type: 'mcut:embed:collapsed', collapsed: !state.expanded })
      if (!visible || document.hidden) post({ type: 'mcut:embed:pause' })
      update({ phase: 'fading' })
      window.setTimeout(() => update({ phase: 'live' }), POSTER_FADE_MS)
      return
    }
    update({ playing: message.playing, userPaused: !message.playing && visible && !document.hidden })
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
  }

  const arm = () => {
    window.clearTimeout(armTimer)
    armed = true
  }

  const expand = () => {
    update(state.phase === 'poster' ? { expanded: true, phase: 'loading', autoplay: false } : { expanded: true })
    post({ type: 'mcut:embed:collapsed', collapsed: false })
    armed = false
    window.clearTimeout(armTimer)
    armTimer = window.setTimeout(arm, SCROLL_ARM_MS)
    window.scrollTo({ top: 0, behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'auto' : 'smooth' })
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.expanded) collapse()
  }

  const onScroll = () => {
    if (!state.expanded) return
    if (!armed) {
      if (window.scrollY <= 1) arm()
      return
    }
    if (window.scrollY > SCROLL_COLLAPSE_PX) collapse()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (state.phase === 'poster' && !window.matchMedia(REDUCED_MOTION_QUERY).matches) update({ phase: 'loading', autoplay: true })
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      listeners.delete(listener)
      window.clearTimeout(armTimer)
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
  }
}

export function HeroDemo({ clip }: { clip: typeof DEMO_CLIP }) {
  const [{ subscribe, getSnapshot, getServerSnapshot, attachContainer, attachFrame, expand, collapse }] = useState(createHeroEmbed)
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const geometry = heroGeometry(state)
  const src = `/embed?clip=${encodeURIComponent(clip.url)}${state.autoplay ? '&autoplay=1' : ''}&muted=1`

  return (
    <>
      <div
        aria-hidden
        onClick={collapse}
        className={cn('fixed inset-0 z-10 bg-overlay/50 transition-opacity', MOTION, state.expanded ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <div
        ref={attachContainer}
        className={cn('relative z-20 transition-[height]', MOTION, geometry === null && 'aspect-video w-full')}
        style={geometry === null ? undefined : { height: geometry.wrapperHeight }}
      >
        <div
          key={geometry === null ? 'placeholder' : 'frame'}
          className={cn(
            'absolute top-0 left-0 rounded-2xl bg-card shadow-[0_24px_64px_-24px] shadow-overlay/45 will-change-transform transition-[width,height,transform,box-shadow]',
            MOTION,
            geometry === null && 'size-full',
          )}
          style={
            geometry === null ? undefined : { width: geometry.frameWidth, height: geometry.frameHeight, transform: `translateX(${geometry.frameTranslateX}px)` }
          }
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 rounded-[inherit] bg-radial-[80%_100%_at_50%_0%] from-violet-500/15 to-transparent" />
          <div
            className={cn(
              'absolute origin-top-left overflow-hidden rounded-lg bg-black will-change-transform transition-transform',
              MOTION,
              geometry === null && 'inset-2',
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
                className={cn('absolute top-0 left-0 border-0', geometry === null && 'size-full')}
                style={geometry === null ? undefined : { width: geometry.stageWidth, height: geometry.stageHeight }}
              />
            )}
            {state.phase !== 'live' && (
              <img
                src={clip.poster}
                alt=""
                width={clip.width}
                height={clip.height}
                fetchPriority="high"
                decoding="async"
                className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', state.phase === 'fading' && 'opacity-0')}
              />
            )}
            {!state.expanded && <button type="button" aria-label="Open the editor" className="absolute inset-0 z-10 cursor-pointer" onClick={expand} />}
          </div>
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/55 to-border to-45% p-px [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]" />
        </div>
      </div>
    </>
  )
}
