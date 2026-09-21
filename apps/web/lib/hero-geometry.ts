export interface HeroMetrics {
  viewportWidth: number
  viewportHeight: number
  containerWidth: number
  wrapperTop: number
  wrapperLeft: number
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

export const FRAME_PAD = 0
const VIEWPORT_PAD = 16

export function heroGeometry({ metrics, expanded }: { metrics: HeroMetrics | null; expanded: boolean }): HeroGeometry | null {
  if (metrics === null) return null
  const availableWidth = metrics.viewportWidth - 2 * VIEWPORT_PAD - 2 * FRAME_PAD
  const availableHeight = metrics.viewportHeight - 2 * VIEWPORT_PAD - 2 * FRAME_PAD
  const stageWidth = Math.floor(Math.min(availableWidth, (availableHeight * 16) / 9))
  const stageHeight = Math.round((stageWidth * 9) / 16)
  const scale = expanded ? 1 : (metrics.containerWidth - 2 * FRAME_PAD) / stageWidth
  const frameWidth = expanded ? stageWidth + 2 * FRAME_PAD : metrics.containerWidth
  const frameHeight = stageHeight * scale + 2 * FRAME_PAD
  const frameTranslateX = expanded ? (metrics.viewportWidth - frameWidth) / 2 - metrics.wrapperLeft : 0
  return { stageWidth, stageHeight, scale, frameWidth, frameHeight, frameTranslateX, wrapperHeight: frameHeight }
}

export function expandedScrollTop(metrics: HeroMetrics): number {
  return Math.max(0, metrics.wrapperTop - VIEWPORT_PAD)
}

export function measureWrapper(wrapper: HTMLDivElement): HeroMetrics {
  const rect = wrapper.getBoundingClientRect()
  return {
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    containerWidth: rect.width,
    wrapperTop: rect.top + window.scrollY,
    wrapperLeft: rect.left,
  }
}

export function sameMetrics(a: HeroMetrics | null, b: HeroMetrics): boolean {
  return (
    a !== null &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.containerWidth === b.containerWidth &&
    a.wrapperTop === b.wrapperTop &&
    a.wrapperLeft === b.wrapperLeft
  )
}
