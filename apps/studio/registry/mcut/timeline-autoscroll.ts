const EDGE_PX = 36
const MAX_STEP_PX = 18

function edgeSpeed(pos: number, min: number, max: number): number {
  if (pos < min + EDGE_PX) return -Math.min(MAX_STEP_PX, ((min + EDGE_PX - pos) / EDGE_PX) * MAX_STEP_PX)
  if (pos > max - EDGE_PX) return Math.min(MAX_STEP_PX, ((pos - (max - EDGE_PX)) / EDGE_PX) * MAX_STEP_PX)
  return 0
}

interface AutoScrollBounds {
  left: number
  right: number
  top: number
  bottom: number
}

interface AutoScrollSource {
  scroller: HTMLElement
  bounds: AutoScrollBounds
  pointer: () => { x: number; y: number } | null
  axes: { x: boolean; y: boolean }
  onScroll: () => void
}

function stepAxis(scroller: HTMLElement, axis: 'scrollLeft' | 'scrollTop', delta: number, max: number): boolean {
  if (delta === 0) return false
  const next = Math.max(0, Math.min(scroller[axis] + delta, max))
  if (next === scroller[axis]) return false
  scroller[axis] = next
  return true
}

export class EdgeAutoScroll {
  private frame: number | null = null

  start(source: AutoScrollSource): void {
    this.stop()
    const { scroller, bounds, axes } = source
    const tick = () => {
      const pointer = source.pointer()
      if (pointer === null) {
        this.frame = null
        return
      }
      const dx = axes.x ? edgeSpeed(pointer.x, bounds.left, bounds.right) : 0
      const dy = axes.y ? edgeSpeed(pointer.y, bounds.top, bounds.bottom) : 0
      const scrolledX = stepAxis(scroller, 'scrollLeft', dx, scroller.scrollWidth - scroller.clientWidth)
      const scrolledY = stepAxis(scroller, 'scrollTop', dy, scroller.scrollHeight - scroller.clientHeight)
      if (scrolledX || scrolledY) source.onScroll()
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  stop(): void {
    if (this.frame === null) return
    cancelAnimationFrame(this.frame)
    this.frame = null
  }
}
