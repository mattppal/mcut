export interface HeroMetrics {
  viewportWidth: number
  viewportHeight: number
  containerWidth: number
}

export interface FrameRect {
  top: number
  left: number
  width: number
  height: number
}

export interface HeroGeometry {
  stageWidth: number
  stageHeight: number
  collapsedHeight: number
  expandedRect: FrameRect
}

const VIEWPORT_PAD = 16

export function heroGeometry(metrics: HeroMetrics | null): HeroGeometry | null {
  if (metrics === null) return null
  const availableWidth = metrics.viewportWidth - 2 * VIEWPORT_PAD
  const availableHeight = metrics.viewportHeight - 2 * VIEWPORT_PAD
  const stageWidth = Math.floor(Math.min(availableWidth, (availableHeight * 16) / 9))
  const stageHeight = Math.round((stageWidth * 9) / 16)
  return {
    stageWidth,
    stageHeight,
    collapsedHeight: Math.round((metrics.containerWidth * 9) / 16),
    expandedRect: {
      top: Math.round((metrics.viewportHeight - stageHeight) / 2),
      left: Math.round((metrics.viewportWidth - stageWidth) / 2),
      width: stageWidth,
      height: stageHeight,
    },
  }
}

export function stageScale(geometry: HeroGeometry, rect: FrameRect): number {
  return rect.width / geometry.stageWidth
}

export function measureWrapper(wrapper: HTMLDivElement): HeroMetrics {
  return {
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    containerWidth: wrapper.getBoundingClientRect().width,
  }
}

export function sameMetrics(a: HeroMetrics | null, b: HeroMetrics): boolean {
  return a !== null && a.viewportWidth === b.viewportWidth && a.viewportHeight === b.viewportHeight && a.containerWidth === b.containerWidth
}
