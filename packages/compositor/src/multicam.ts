import {
  getActiveLayout,
  getAngleTransitionAt,
  getClipView,
  getLayout,
  getMulticamGroupTimeMs,
  getMulticamSourceTimeMs,
  getTransitionCompletion,
  getZoomedRect,
  isAudioOnlySource,
  resolveAnimatedElement,
  type Layout,
  type LayoutSlot,
  type MulticamElement,
  type MulticamSource,
  type Project,
} from '@mcut/timeline'
import type { LayerChrome } from './backend'
import { drawFramedMedia, type FrameBox, type SourceRect } from './framed-media'
import { degToRad, toCanvasPoint, type OBB } from './geometry'
import { reframedSlot } from './reframe-views'
import { transitionRenderers } from './transition-renderers'
import type { ElementRenderContext, FrameSource } from './types'

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

const WHOLE_FRAME = { x: 0, y: 0, w: 1, h: 1 }

const MAX_COMPOSE_SIDE_PX = 8192

const ROUNDING_SLACK = 1e-9

const ceilTolerant = (value: number): number => Math.ceil(value - ROUNDING_SLACK)

const roundUpToQuarterOctave = (ratio: number): number => 2 ** (ceilTolerant(Math.log2(ratio) * 4) / 4)

function composeAxis(length: number, density: number, frame: number): { pixels: number; density: number } {
  if (!(density > 0 && frame > 0)) return { pixels: 1, density: 1 / length }
  const pixels = Math.min(MAX_COMPOSE_SIDE_PX, Math.max(1, ceilTolerant(frame * roundUpToQuarterOctave((length * density) / frame))))
  return { pixels, density: Math.min(density, pixels / length) }
}

export function composeMulticam(
  element: MulticamElement,
  context: ElementRenderContext,
  frames: FrameSource,
  chrome: LayerChrome,
): { image: CanvasImageSource; src: SourceRect } | null {
  const { project } = context
  const { width, height } = project
  const groupMs = getMulticamGroupTimeMs(element, context.timeMs)
  const transition = getAngleTransitionAt(element, groupMs)
  const layouts = transition
    ? [getLayout(project.layouts, transition.fromLayoutId), getLayout(project.layouts, transition.toLayoutId)]
    : [getActiveLayout(project, element, context.timeMs)]
  const placed = layouts.map((layout) => (layout ? placeSlots(project, element, layout) : []))
  const crop = element.crop ?? WHOLE_FRAME
  const { renderScale } = context.backend
  const across = composeAxis(crop.w * width, Math.abs(chrome.scaleX) * renderScale, width * renderScale)
  const down = composeAxis(crop.h * height, Math.abs(chrome.scaleY) * renderScale, height * renderScale)
  const surface = context.acquireScratch(across.pixels, down.pixels)
  if (!surface) return null
  surface.setTransform(1, 0, 0, 1, 0, 0)
  surface.clearRect(0, 0, across.pixels, down.pixels)
  surface.setTransform(across.density, 0, 0, down.density, -across.density * crop.x * width, -down.density * crop.y * height)
  const view = getClipView(element, context.viewTimeMs)

  const drawSlots = (slots: readonly PlacedSlot[] = []) => {
    if (slots.length === 0) return
    surface.save()
    surface.translate(width / 2, height / 2)
    if (view.scale > 1) {
      const zoomed = getZoomedRect(view, WHOLE_FRAME)
      surface.beginPath()
      surface.rect(-width / 2, -height / 2, width, height)
      surface.clip()
      surface.translate((zoomed.x + zoomed.w / 2 - 0.5) * width, (zoomed.y + zoomed.h / 2 - 0.5) * height)
      surface.scale(zoomed.w, zoomed.h)
    }
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
  } else {
    drawSlots(placed[0])
  }
  return { image: surface.canvas, src: { sx: 0, sy: 0, sw: across.density * crop.w * width, sh: down.density * crop.h * height } }
}
