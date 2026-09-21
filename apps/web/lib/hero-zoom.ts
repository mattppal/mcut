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

export function zoomScrollTop(metrics: HeroMetrics, expanded: boolean): number {
  const geometry = heroGeometry({ metrics, expanded })
  return geometry === null ? 0 : centeredScrollTop(metrics, geometry.wrapperHeight)
}

export function runZoom(metrics: HeroMetrics, expanded: boolean, nodes: ZoomNodes, onDone: () => void): () => void {
  const from = heroGeometry({ metrics, expanded: !expanded })
  const to = heroGeometry({ metrics, expanded })
  if (from === null || to === null) {
    onDone()
    return () => {}
  }
  const scrollFrom = window.scrollY
  const scrollTo = zoomScrollTop(metrics, expanded)
  let handle = 0
  let start = 0
  const tick = (now: number) => {
    if (start === 0) start = now
    const p = easeOutExpo(Math.min(1, (now - start) / ZOOM_MS))
    writeGeometry(nodes, interpolate(from, to, p))
    window.scrollTo(0, Math.round(lerp(scrollFrom, scrollTo, p)))
    if (p < 1) {
      handle = window.requestAnimationFrame(tick)
      return
    }
    handle = 0
    onDone()
  }
  handle = window.requestAnimationFrame(tick)
  return () => window.cancelAnimationFrame(handle)
}
