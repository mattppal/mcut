import {
  getActiveLayout,
  getAngleTransitionAt,
  getLayout,
  getMulticamGroupTimeMs,
  getMulticamSourceTimeMs,
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
import { reframedSlot } from './reframe-views'
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

const MAX_COMPOSE_SIDE_PX = 8192

const roundUpToQuarterOctave = (scale: number): number => 2 ** (Math.ceil(Math.log2(scale) * 4) / 4)

function sourceDensity(project: Project, { slot, source, box }: PlacedSlot): number {
  const asset = project.assets[source.assetId]
  if (!asset?.width || !asset.height) return Number.POSITIVE_INFINITY
  const across = (asset.width * (slot.crop?.w ?? 1)) / box.w
  const down = (asset.height * (slot.crop?.h ?? 1)) / box.h
  return slot.fit === 'cover' ? Math.min(across, down) : Math.max(across, down)
}

function composeSize(project: Project, element: MulticamElement, slots: readonly PlacedSlot[], renderScale: number): { width: number; height: number } {
  const cap = Math.max(renderScale, ...slots.map((placed) => sourceDensity(project, placed)))
  const side = (length: number, scale: number) => {
    const density = Math.min(roundUpToQuarterOctave(Math.abs(scale)) * renderScale, cap)
    return Math.max(1, Math.min(MAX_COMPOSE_SIDE_PX, Math.ceil(length * density)))
  }
  return { width: side(project.width, element.transform.scaleX), height: side(project.height, element.transform.scaleY) }
}

export function composeMulticam(element: MulticamElement, context: ElementRenderContext, frames: FrameSource): Canvas2D | null {
  const { project } = context
  const groupMs = getMulticamGroupTimeMs(element, context.timeMs)
  const transition = getAngleTransitionAt(element, groupMs)
  const layouts = transition
    ? [getLayout(project.layouts, transition.fromLayoutId), getLayout(project.layouts, transition.toLayoutId)]
    : [getActiveLayout(project, element, context.timeMs)]
  const placed = layouts.map((layout) => (layout ? placeSlots(project, element, layout) : []))
  const { width, height } = composeSize(project, element, placed.flat(), context.backend.renderScale)
  const surface = context.acquireScratch(width, height)
  if (!surface) return null
  surface.setTransform(width / project.width, 0, 0, height / project.height, 0, 0)
  surface.clearRect(0, 0, project.width, project.height)

  const drawSlots = (slots: readonly PlacedSlot[] = []) => {
    if (slots.length === 0) return
    surface.save()
    surface.translate(project.width / 2, project.height / 2)
    for (const { slot, source, box } of slots) {
      const frame = frames.getFrame(source.assetId, getMulticamSourceTimeMs(element, source, context.timeMs))
      if (!frame) continue
      const framing = reframedSlot(element, slot, context.timeMs, context.viewTimeMs)
      drawFramedMedia(surface, frame, box, framing.slot, slot.fit, framing.viewFor)
    }
    surface.restore()
  }

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
      drawLeft: () => drawSlots(placed[0]),
      drawRight: () => drawSlots(placed[1]),
    })
    return surface
  }

  drawSlots(placed[0])
  return surface
}
