import { stageScale, type FrameRect, type HeroGeometry } from './hero-geometry'

export const ZOOM_MS = 600

export interface ZoomNodes {
  wrapper: HTMLElement
  frame: HTMLElement
  stage: HTMLElement
}

export interface Zoom {
  from: FrameRect
  cancel: () => FrameRect
}

const easeOutExpo = (p: number): number => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p))
const lerp = (from: number, to: number, p: number): number => from + (to - from) * p

function interpolate(from: FrameRect, to: FrameRect, p: number): FrameRect {
  return { top: lerp(from.top, to.top, p), left: lerp(from.left, to.left, p), width: lerp(from.width, to.width, p), height: lerp(from.height, to.height, p) }
}

export function writeFixedFrame({ frame, stage }: ZoomNodes, geometry: HeroGeometry, rect: FrameRect): void {
  frame.style.position = 'fixed'
  frame.style.top = `${rect.top}px`
  frame.style.left = `${rect.left}px`
  frame.style.width = `${rect.width}px`
  frame.style.height = `${rect.height}px`
  stage.style.transform = `scale(${stageScale(geometry, rect)})`
}

export function wrapperRect(wrapper: HTMLElement): FrameRect {
  const rect = wrapper.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export function runZoom(geometry: HeroGeometry, nodes: ZoomNodes, from: FrameRect, to: FrameRect, onDone: () => void): Zoom {
  let current = from
  let handle = 0
  const began = performance.now()
  const tick = (now: number) => {
    const p = easeOutExpo(Math.min(1, (now - began) / ZOOM_MS))
    current = interpolate(from, to, p)
    writeFixedFrame(nodes, geometry, current)
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
