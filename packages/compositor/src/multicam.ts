import {
  getActiveLayout,
  getAngleTransitionAt,
  getLayout,
  getMulticamGroupTimeMs,
  getMulticamSourceTimeMs,
  getSlotView,
  getTransitionCompletion,
  isAudioOnlySource,
  resolveAnimatedElement,
  type Layout,
  type LayoutSlot,
  type MulticamElement,
  type MulticamSource,
  type Project,
} from '@mcut/timeline'
import { drawFramedMedia, type FrameBox } from './framed-media'
import { degToRad, toCanvasPoint, type OBB } from './geometry'
import { transitionRenderers } from './transition-renderers'
import type { Canvas2D, ElementRenderContext, FrameSource } from './types'

interface PlacedSlot {
  slot: LayoutSlot
  source: MulticamSource
  box: FrameBox
}

function placeSlots(project: Project, element: MulticamElement, layout: Layout): PlacedSlot[] {
  const { width, height } = project
  return layout.slots.flatMap((slot) => {
    const source = element.sources.find((s) => s.key === slot.source)
    if (!source || isAudioOnlySource(project, source)) return []
    const { x, y, w, h } = slot.rect
    return [{ slot, source, box: { x: (x - 0.5) * width, y: (y - 0.5) * height, w: w * width, h: h * height } }]
  })
}

export interface SlotBox {
  sourceKey: string
  obb: OBB
}

export function getSlotBoxes(project: Project, element: MulticamElement, timelineMs: number): SlotBox[] {
  const resolved = resolveAnimatedElement(element, timelineMs)
  const layout = getActiveLayout(project, resolved, timelineMs)
  if (!layout) return []
  const { transform } = resolved
  const kept = resolved.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const keptX = (kept.x + kept.w / 2 - 0.5) * project.width
  const keptY = (kept.y + kept.h / 2 - 0.5) * project.height
  const center = toCanvasPoint(project, transform.x, transform.y)
  const cos = Math.cos(degToRad(transform.rotation))
  const sin = Math.sin(degToRad(transform.rotation))
  return placeSlots(project, resolved, layout).map(({ slot, box }) => {
    const x = (box.x + box.w / 2 - keptX) * transform.scaleX
    const y = (box.y + box.h / 2 - keptY) * transform.scaleY
    return {
      sourceKey: slot.source,
      obb: {
        cx: center.x + x * cos - y * sin,
        cy: center.y + x * sin + y * cos,
        width: box.w * Math.abs(transform.scaleX),
        height: box.h * Math.abs(transform.scaleY),
        rotation: transform.rotation,
      },
    }
  })
}

export function composeMulticam(surface: Canvas2D, element: MulticamElement, context: ElementRenderContext, frames: FrameSource): void {
  const { project } = context
  surface.setTransform(surface.canvas.width / project.width, 0, 0, surface.canvas.height / project.height, 0, 0)
  surface.clearRect(0, 0, project.width, project.height)

  const drawLayout = (layout: Layout | null) => {
    if (!layout) return
    surface.save()
    surface.translate(project.width / 2, project.height / 2)
    for (const { slot, source, box } of placeSlots(project, element, layout)) {
      const frame = frames.getFrame(source.assetId, getMulticamSourceTimeMs(element, source, context.timeMs))
      if (frame) drawFramedMedia(surface, frame, box, slot, slot.fit, (visible) => getSlotView(element, slot, context.viewTimeMs, visible))
    }
    surface.restore()
  }

  const groupMs = getMulticamGroupTimeMs(element, context.timeMs)
  const transition = getAngleTransitionAt(element, groupMs)
  if (transition) {
    const pair = {
      left: element,
      right: element,
      cutMs: transition.cutMs,
      durationMs: transition.durationMs,
      type: transition.type,
    }
    transitionRenderers[transition.type]({
      ctx: surface,
      project,
      pair,
      timeMs: groupMs,
      completion: getTransitionCompletion(pair, groupMs),
      drawLeft: () => drawLayout(getLayout(project.layouts, transition.fromLayoutId)),
      drawRight: () => drawLayout(getLayout(project.layouts, transition.toLayoutId)),
    })
    return
  }

  drawLayout(getActiveLayout(project, element, context.timeMs))
}
