'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { readEmbedMessage, type ParentMessage } from '@/lib/embed-protocol'
import { XIcon } from '@/lib/hugeicons'
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
  width: number
  height: number
  scale: number
  translateX: number
  wrapperHeight: number
}

const INITIAL_STATE: HeroState = { phase: 'poster', autoplay: false, expanded: false, playing: false, userPaused: false, metrics: null }
const VISIBLE_RATIO = 0.25
const POSTER_FADE_MS = 400
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const MOTION = 'duration-[600ms] ease-out-expo motion-reduce:transition-none'

function heroGeometry({ metrics, expanded }: HeroState): HeroGeometry | null {
  if (metrics === null) return null
  const width = metrics.viewportWidth
  const height = metrics.viewportHeight - metrics.wrapperTop
  const scale = expanded ? 1 : metrics.containerWidth / width
  const translateX = expanded ? -(width - metrics.containerWidth) / 2 : 0
  return { width, height, scale, translateX, wrapperHeight: height * scale }
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

  const expand = () => {
    update(state.phase === 'poster' ? { expanded: true, phase: 'loading', autoplay: false } : { expanded: true })
    post({ type: 'mcut:embed:collapsed', collapsed: false })
    window.scrollTo({ top: 0, behavior: window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'auto' : 'smooth' })
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.expanded) collapse()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (state.phase === 'poster' && !window.matchMedia(REDUCED_MOTION_QUERY).matches) update({ phase: 'loading', autoplay: true })
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('resize', measure)
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
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label="Collapse the editor"
          inert={!state.expanded}
          onClick={collapse}
          className={cn('absolute -top-10 right-6 z-30 transition-opacity', MOTION, !state.expanded && 'pointer-events-none opacity-0')}
        >
          <XIcon />
        </Button>
        <div
          key={geometry === null ? 'placeholder' : 'stage'}
          className={cn(
            'absolute top-0 left-0 origin-top-left overflow-hidden bg-black will-change-transform transition-[transform,border-radius,box-shadow]',
            MOTION,
            geometry === null && 'size-full',
            state.expanded ? 'rounded-none shadow-none' : 'rounded-xl shadow-[0_24px_64px_-24px] shadow-overlay/45',
          )}
          style={
            geometry === null
              ? undefined
              : { width: geometry.width, height: geometry.height, transform: `translateX(${geometry.translateX}px) scale(${geometry.scale})` }
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
              style={geometry === null ? undefined : { width: geometry.width, height: geometry.height }}
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
          <div
            className={cn(
              'pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/55 to-border to-45% p-px transition-opacity [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]',
              MOTION,
              state.expanded && 'opacity-0',
            )}
          />
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 h-40 bg-radial-[80%_100%_at_50%_0%] from-violet-500/15 to-transparent transition-opacity',
              MOTION,
              state.expanded && 'opacity-0',
            )}
          />
          {!state.expanded && <button type="button" aria-label="Open the editor" className="absolute inset-0 z-10 cursor-pointer" onClick={expand} />}
        </div>
      </div>
    </>
  )
}
