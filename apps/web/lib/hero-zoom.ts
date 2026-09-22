import { FRAME_PAD, centeredScrollTop, heroGeometry, type HeroGeometry, type HeroMetrics } from './hero-geometry'

export const ZOOM_MS = 600

export interface ZoomNodes {
  wrapper: HTMLElement
  frame: HTMLElement
  stage: HTMLElement
  poster: HTMLElement | null
}

const easeOutExpo = (p: number): number => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p))
const lerp = (from: number, to: number, p: number): number => from + (to - from) * p

function interpolate(from: HeroGeometry, to: HeroGeometry, p: number): HeroGeometry {
  return {
    stageWidth: to.stageWidth,
    stageHeight: to.stageHeight,
    scale: lerp(from.scale, to.scale, p),
    frameWidth: lerp(from.frameWidth, to.frameWidth, p),
    frameHeight: lerp(from.frameHeight, to.frameHeight, p),
    frameTranslateX: lerp(from.frameTranslateX, to.frameTranslateX, p),
    wrapperHeight: lerp(from.wrapperHeight, to.wrapperHeight, p),
  }
}

export function writeGeometry({ wrapper, frame, stage, poster }: ZoomNodes, geometry: HeroGeometry): void {
  wrapper.style.height = `${geometry.wrapperHeight}px`
  frame.style.width = `${geometry.frameWidth}px`
  frame.style.height = `${geometry.frameHeight}px`
  frame.style.transform = `translateX(${geometry.frameTranslateX}px)`
  stage.style.transform = `scale(${geometry.scale})`
  if (poster === null) return
  poster.style.top = `${FRAME_PAD}px`
  poster.style.left = `${FRAME_PAD + geometry.frameTranslateX}px`
  poster.style.width = `${geometry.stageWidth * geometry.scale}px`
  poster.style.height = `${geometry.stageHeight * geometry.scale}px`
}

export interface ZoomSnapshot {
  geometry: HeroGeometry
  scrollY: number
}

export interface Zoom {
  from: ZoomSnapshot
  cancel: () => ZoomSnapshot
}

export function zoomScrollTop(metrics: HeroMetrics, expanded: boolean): number {
  const geometry = heroGeometry({ metrics, expanded })
  if (geometry === null) return 0
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - metrics.viewportHeight)
  return Math.min(maxScroll, centeredScrollTop(metrics, geometry.wrapperHeight))
}

export function runZoom(metrics: HeroMetrics, expanded: boolean, nodes: ZoomNodes, resume: ZoomSnapshot | null, onDone: () => void): Zoom | null {
  const start = resume ?? { geometry: heroGeometry({ metrics, expanded: !expanded }), scrollY: window.scrollY }
  const to = heroGeometry({ metrics, expanded })
  if (start.geometry === null || to === null) return null
  const from: ZoomSnapshot = { geometry: start.geometry, scrollY: start.scrollY }
  const scrollTo = zoomScrollTop(metrics, expanded)
  let current = from
  let handle = 0
  let began = 0
  const tick = (now: number) => {
    if (began === 0) began = now
    const p = easeOutExpo(Math.min(1, (now - began) / ZOOM_MS))
    current = { geometry: interpolate(from.geometry, to, p), scrollY: Math.round(lerp(from.scrollY, scrollTo, p)) }
    writeGeometry(nodes, current.geometry)
    window.scrollTo(0, current.scrollY)
    if (p < 1) {
      handle = window.requestAnimationFrame(tick)
      return
    }
    handle = 0
    onDone()
  }
  handle = window.requestAnimationFrame(tick)
  return {
    from,
    cancel: () => {
      window.cancelAnimationFrame(handle)
      return current
    },
  }
}
