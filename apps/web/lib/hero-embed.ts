import { handOff, type ReplayPhase, type TraceMode } from './agent-replay'
import { AGENT_SCRIPT, LEAD_IN_MS } from './agent-script'
import { readEmbedMessage, type EmbedResult, type ParentMessage } from './embed-protocol'
import { heroGeometry, measureWrapper, sameMetrics, type FrameRect, type HeroMetrics } from './hero-geometry'
import { runZoom, wrapperRect, type Zoom, type ZoomNodes } from './hero-zoom'

export type Phase = 'poster' | 'loading' | 'slow' | 'fading' | 'live'

export interface HeroState {
  phase: Phase
  autoplay: boolean
  expanded: boolean
  playing: boolean
  userPaused: boolean
  reducedMotion: boolean
  metrics: HeroMetrics | null
  animatingFrom: FrameRect | null
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
  animatingFrom: null,
  replay: { kind: 'waiting' },
  results: new Map(),
}
const VISIBLE_RATIO = 0.25
const POSTER_FADE_MS = 600
const READY_TIMEOUT_MS = 8000
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const AUTOPLAY_WIDTH_QUERY = '(min-width: 640px)'

export const isReady = (phase: Phase): boolean => phase === 'fading' || phase === 'live'
export const traceMode = (phase: Phase): TraceMode => (isReady(phase) ? 'live' : 'recorded')

function savesData(): boolean {
  const nav: unknown = navigator
  if (typeof nav !== 'object' || nav === null || !('connection' in nav)) return false
  const { connection } = nav
  return typeof connection === 'object' && connection !== null && 'saveData' in connection && connection.saveData === true
}

function canAutoplay(reducedMotion: boolean): boolean {
  return !reducedMotion && window.matchMedia(AUTOPLAY_WIDTH_QUERY).matches && !savesData()
}

export function createHeroEmbed() {
  let state = INITIAL_STATE
  let frame: HTMLIFrameElement | null = null
  let wrapper: HTMLDivElement | null = null
  let frameCard: HTMLDivElement | null = null
  let stage: HTMLDivElement | null = null
  let activeZoom: Zoom | null = null
  let visible = false
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
    if (wrapper === null || state.animatingFrom !== null) return
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

  const zoomNodes = (): ZoomNodes | null => (wrapper === null || frameCard === null || stage === null ? null : { wrapper, frame: frameCard, stage })

  const zoom = (expanded: boolean, patch: Partial<HeroState>) => {
    const resume = activeZoom?.cancel() ?? null
    activeZoom = null
    measure()
    const geometry = heroGeometry(state.metrics)
    const nodes = zoomNodes()
    if (geometry === null || nodes === null || state.reducedMotion) {
      update({ ...patch, expanded, animatingFrom: null })
      return
    }
    const inFlow = wrapperRect(nodes.wrapper)
    const from = resume ?? (expanded ? inFlow : geometry.expandedRect)
    const to = expanded ? geometry.expandedRect : inFlow
    activeZoom = runZoom(geometry, nodes, from, to, () => {
      activeZoom = null
      update({ animatingFrom: null })
    })
    update({ ...patch, expanded, animatingFrom: from })
  }

  const collapse = () => {
    zoom(false, {})
    post({ type: 'mcut:embed:collapsed', collapsed: true })
  }

  const expand = () => {
    window.clearTimeout(scriptTimer)
    const replay = handOff(state.replay)
    if (state.phase === 'poster') startLoading({ autoplay: false })
    zoom(true, { replay })
    post({ type: 'mcut:embed:collapsed', collapsed: false })
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

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches
    if (state.reducedMotion !== reducedMotion) update({ reducedMotion })
    if (state.phase === 'poster' && canAutoplay(reducedMotion)) startLoading({ autoplay: true })
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      listeners.delete(listener)
      activeZoom?.cancel()
      window.clearTimeout(scriptTimer)
      window.clearTimeout(readyTimer)
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

  const attachFrameCard = (node: HTMLDivElement | null) => {
    frameCard = node
  }

  const attachStage = (node: HTMLDivElement | null) => {
    stage = node
  }

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL_STATE,
    subscribe,
    attachContainer,
    attachFrame,
    attachFrameCard,
    attachStage,
    expand,
    collapse,
    load,
    run,
    replay,
  }
}
