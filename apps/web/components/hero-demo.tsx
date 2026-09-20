'use client'

import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import type { DEMO_CLIP } from '@/lib/demo-clip'
import { readEmbedMessage, type ParentMessage } from '@/lib/embed-protocol'
import { XIcon } from '@/lib/hugeicons'
import { cn } from '@/lib/utils'

type Phase = 'poster' | 'loading' | 'fading' | 'live'

interface HeroState {
  phase: Phase
  autoplay: boolean
  expanded: boolean
  playing: boolean
  userPaused: boolean
}

const INITIAL_STATE: HeroState = { phase: 'poster', autoplay: false, expanded: false, playing: false, userPaused: false }
const VISIBLE_RATIO = 0.25
const POSTER_FADE_MS = 400
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function createHeroEmbed() {
  let state = INITIAL_STATE
  let frame: HTMLIFrameElement | null = null
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

  const onMessage = (event: MessageEvent) => {
    if (frame === null || event.origin !== window.location.origin || event.source !== frame.contentWindow) return
    const message = readEmbedMessage(event.data)
    if (message === null) return
    if (message.type === 'mcut:embed:ready') {
      post({ type: 'mcut:embed:layout', compact: !state.expanded })
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
    post({ type: 'mcut:embed:layout', compact: true })
  }

  const expand = () => {
    update(state.phase === 'poster' ? { expanded: true, phase: 'loading', autoplay: false } : { expanded: true })
    post({ type: 'mcut:embed:layout', compact: false })
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.expanded) collapse()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (state.phase === 'poster' && !window.matchMedia(REDUCED_MOTION_QUERY).matches) update({ phase: 'loading', autoplay: true })
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKeydown)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  const attachContainer = (node: HTMLDivElement | null) => {
    if (node === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1)
        if (entry) setVisible(entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO)
      },
      { threshold: [0, VISIBLE_RATIO] },
    )
    observer.observe(node)
    return () => observer.disconnect()
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
  const src = `/embed?clip=${encodeURIComponent(clip.url)}${state.autoplay ? '&autoplay=1' : ''}&muted=1`

  return (
    <div
      ref={attachContainer}
      className={cn(
        'relative overflow-hidden bg-black transition-[height] duration-300',
        state.expanded ? 'mx-[calc(50%-50vw)] h-[calc(100dvh-5rem)] w-screen' : 'aspect-video w-full rounded-xl border',
      )}
    >
      {state.phase !== 'poster' && <iframe ref={attachFrame} src={src} title="mcut Studio" allow="autoplay" className="absolute inset-0 size-full border-0" />}
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
      {state.expanded ? (
        <Button size="icon-sm" variant="secondary" aria-label="Collapse the editor" className="absolute top-3 right-3 z-10" onClick={collapse}>
          <XIcon />
        </Button>
      ) : (
        <button type="button" aria-label="Open the editor" className="absolute inset-0 z-10 cursor-pointer" onClick={expand} />
      )}
    </div>
  )
}
