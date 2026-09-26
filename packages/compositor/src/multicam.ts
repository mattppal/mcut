import {
  assertNever,
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
  type Effect,
  type Layout,
  type LayoutSlot,
  type MulticamElement,
  type MulticamSource,
  type Project,
} from '@mcut/timeline'
import { applyChrome, chromeOf, transformByChrome, type LayerChrome, type PixelGrid } from './backend'
import {
  cropSourceRect,
  drawFrameShadow,
  drawFrameStroke,
  frameRadius,
  getImageSize,
  placeSource,
  withFrameChrome,
  type FrameBox,
  type SourceRect,
} from './framed-media'
import { degToRad, type OBB } from './geometry'
import { reframedSlot } from './reframe-views'
import { transitionRenderers } from './transition-renderers'
import type { Canvas2D, ElementRenderContext, ElementRenderer } from './types'

interface PlacedSlotBox {
  slot: LayoutSlot
  source: MulticamSource
  box: FrameBox
}

function placeSlots(project: Project, element: MulticamElement, layout: Layout): PlacedSlotBox[] {
  const { width, height } = project
  return layout.slots.flatMap((slot) => {
    const source = element.sources.find((s) => s.key === slot.source)
    if (!source || isAudioOnlySource(project, source)) return []
    const { x, y, w, h } = slot.rect
    return [{ slot, source, box: { x: (x - 0.5) * width, y: (y - 0.5) * height, w: w * width, h: h * height } }]
  })
}

interface Point {
  x: number
  y: number
}

type CompositeStep = { kind: 'clip'; box: FrameBox; radius: number } | { kind: 'map'; shift: Point; scale: Point }

const clip = (box: FrameBox, radius = 0): CompositeStep => ({ kind: 'clip', box, radius })

const map = (shift: Point, scale: Point = { x: 1, y: 1 }): CompositeStep => ({ kind: 'map', shift, scale })

interface CompositePlacement {
  bounds: FrameBox
  radius: number
  frame: CompositeStep[]
  zoom: CompositeStep[]
}

const WHOLE_FRAME = { x: 0, y: 0, w: 1, h: 1 }

function zoomSteps(project: Project, element: MulticamElement, viewTimeMs: number): CompositeStep[] {
  const view = getClipView(element, viewTimeMs)
  if (!(view.scale > 1)) return []
  const { width, height } = project
  const zoomed = getZoomedRect(view, WHOLE_FRAME)
  return [
    clip({ x: -width / 2, y: -height / 2, w: width, h: height }),
    map({ x: (zoomed.x + zoomed.w / 2 - 0.5) * width, y: (zoomed.y + zoomed.h / 2 - 0.5) * height }, { x: zoomed.w, y: zoomed.h }),
  ]
}

const EDGE_SLACK_PX = 1e-6

const leaves = (box: FrameBox, frame: FrameBox): boolean =>
  box.x < frame.x - EDGE_SLACK_PX ||
  box.y < frame.y - EDGE_SLACK_PX ||
  box.x + box.w > frame.x + frame.w + EDGE_SLACK_PX ||
  box.y + box.h > frame.y + frame.h + EDGE_SLACK_PX

function placeComposite(project: Project, element: MulticamElement, viewTimeMs: number, boxes: readonly FrameBox[]): CompositePlacement {
  const { width, height } = project
  const crop = element.crop ?? WHOLE_FRAME
  const bounds = { x: (-crop.w * width) / 2, y: (-crop.h * height) / 2, w: crop.w * width, h: crop.h * height }
  const radius = frameRadius(element, bounds)
  const zoom = zoomSteps(project, element, viewTimeMs)
  const confined = radius > 0 || element.crop !== undefined || zoom.length > 0
  const frame = [
    ...(radius > 0 ? [clip(bounds, radius)] : []),
    ...(element.crop ? [clip(bounds), map({ x: (0.5 - crop.x - crop.w / 2) * width, y: (0.5 - crop.y - crop.h / 2) * height })] : []),
    ...(!confined && boxes.some((box) => leaves(box, bounds)) ? [clip(bounds)] : []),
  ]
  return { bounds, radius, frame, zoom }
}

function applySteps(ctx: Canvas2D, steps: readonly CompositeStep[]): void {
  for (const step of steps) {
    switch (step.kind) {
      case 'clip': {
        const { box, radius } = step
        ctx.beginPath()
        if (radius > 0) ctx.roundRect(box.x, box.y, box.w, box.h, radius)
        else ctx.rect(box.x, box.y, box.w, box.h)
        ctx.clip()
        break
      }
      case 'map':
        ctx.translate(step.shift.x, step.shift.y)
        if (step.scale.x !== 1 || step.scale.y !== 1) ctx.scale(step.scale.x, step.scale.y)
        break
      default:
        assertNever(step)
    }
  }
}

function intersect(a: FrameBox, b: FrameBox): FrameBox | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x
  const h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

function shownThrough(steps: readonly CompositeStep[], box: FrameBox): FrameBox | null {
  return steps.reduceRight<FrameBox | null>((shown, step) => {
    if (!shown) return null
    switch (step.kind) {
      case 'clip':
        return intersect(shown, step.box)
      case 'map': {
        const { shift, scale } = step
        return { x: shift.x + scale.x * shown.x, y: shift.y + scale.y * shown.y, w: scale.x * shown.w, h: scale.y * shown.h }
      }
      default:
        return assertNever(step)
    }
  }, box)
}

function onChrome(chrome: LayerChrome, x: number, y: number): Point {
  const angle = degToRad(chrome.rotationDeg)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: chrome.centerX + cos * chrome.scaleX * x - sin * chrome.scaleY * y,
    y: chrome.centerY + sin * chrome.scaleX * x + cos * chrome.scaleY * y,
  }
}

export interface SlotBox {
  sourceKey: string
  obb: OBB
}

export function getSlotBoxes(project: Project, element: MulticamElement, timelineMs: number): SlotBox[] {
  const resolved = resolveAnimatedElement(element, timelineMs)
  const layout = getActiveLayout(project, resolved, timelineMs)
  if (!layout) return []
  const slots = placeSlots(project, resolved, layout)
  const { frame, zoom } = placeComposite(
    project,
    resolved,
    timelineMs,
    slots.map(({ box }) => box),
  )
  const chrome = chromeOf(project, resolved)
  return slots.flatMap(({ slot, box }) => {
    const shown = shownThrough([...frame, ...zoom], box)
    if (!shown) return []
    const center = onChrome(chrome, shown.x + shown.w / 2, shown.y + shown.h / 2)
    const obb = {
      cx: center.x,
      cy: center.y,
      width: shown.w * Math.abs(chrome.scaleX),
      height: shown.h * Math.abs(chrome.scaleY),
      rotation: chrome.rotationDeg,
    }
    return [{ sourceKey: slot.source, obb }]
  })
}

interface Picture {
  image: CanvasImageSource
  width: number
  height: number
}

interface PlacedSlot {
  style: LayoutSlot
  source: MulticamSource
  box: FrameBox
  src: SourceRect
  dest: FrameBox
  image: CanvasImageSource
}

function placeLayout(
  project: Project,
  element: MulticamElement,
  layout: Layout,
  timeMs: number,
  viewTimeMs: number,
  pictureOf: (source: MulticamSource) => Picture | null,
): PlacedSlot[] {
  return placeSlots(project, element, layout).flatMap(({ slot, source, box }) => {
    const picture = pictureOf(source)
    if (!picture) return []
    const framing = reframedSlot(element, slot, timeMs, viewTimeMs)
    const base = cropSourceRect(framing.slot.crop, picture) ?? { sx: 0, sy: 0, sw: picture.width, sh: picture.height }
    const { src, dest } = placeSource(base, box, slot.fit, framing.viewFor)
    return [{ style: framing.slot, source, box, src, dest, image: picture.image }]
  })
}

const MAX_COMPOSE_SIDE_PX = 8192

const neighborMargin = (side: number): number => Math.max(0, Math.floor((MAX_COMPOSE_SIDE_PX - side) / 2))

const READS_NEIGHBORS: Record<Effect['type'], boolean> = {
  brightness: false,
  contrast: false,
  saturate: false,
  grayscale: false,
  sepia: false,
  'hue-rotate': false,
  invert: false,
  'chroma-key': false,
  curves: false,
  lut3d: false,
  blur: true,
  'drop-shadow': true,
  css: true,
}

function layerRect({ transform: { a, b, c, d, e, f }, width, height }: PixelGrid, chrome: LayerChrome, bounds: FrameBox): FrameBox | null {
  const corners = [bounds.x, bounds.x + bounds.w].flatMap((x) =>
    [bounds.y, bounds.y + bounds.h].map((y) => {
      const p = onChrome(chrome, x, y)
      return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }
    }),
  )
  const spills = chrome.effects?.some((effect) => effect.enabled && READS_NEIGHBORS[effect.type]) ?? false
  const marginX = spills ? neighborMargin(width) : 0
  const marginY = spills ? neighborMargin(height) : 0
  const x = Math.max(-marginX, Math.floor(Math.min(...corners.map((p) => p.x)) + EDGE_SLACK_PX))
  const y = Math.max(-marginY, Math.floor(Math.min(...corners.map((p) => p.y)) + EDGE_SLACK_PX))
  const w = Math.min(width + marginX, Math.ceil(Math.max(...corners.map((p) => p.x)) - EDGE_SLACK_PX)) - x
  const h = Math.min(height + marginY, Math.ceil(Math.max(...corners.map((p) => p.y)) - EDGE_SLACK_PX)) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

function blitPlacement({ transform: { a, b, c, d, e, f } }: PixelGrid, layer: FrameBox) {
  const det = a * d - b * c
  const x = layer.x + layer.w / 2 - e
  const y = layer.y + layer.h / 2 - f
  const m00 = d / det
  const m10 = -b / det
  const m01 = -c / det
  const m11 = a / det
  const rotation = Math.atan2(m10, m00)
  return {
    centerX: (d * x - c * y) / det,
    centerY: (a * y - b * x) / det,
    rotationDeg: (rotation * 180) / Math.PI || 0,
    scaleX: Math.hypot(m00, m10),
    scaleY: m11 * Math.cos(rotation) - m01 * Math.sin(rotation),
  }
}

function drawLayer(context: ElementRenderContext, chrome: LayerChrome, bounds: FrameBox, draw: (surface: Canvas2D) => void): void {
  const grid = context.backend.pixelGrid()
  const layer = layerRect(grid, chrome, bounds)
  if (!layer) return
  const originX = Math.min(0, layer.x)
  const originY = Math.min(0, layer.y)
  const surface = context.acquireScratch(Math.max(grid.width, layer.x + layer.w) - originX, Math.max(grid.height, layer.y + layer.h) - originY)
  const src = { sx: layer.x - originX, sy: layer.y - originY, sw: layer.w, sh: layer.h }
  const { a, b, c, d, e, f } = grid.transform
  surface.save()
  surface.setTransform(1, 0, 0, 1, 0, 0)
  surface.clearRect(src.sx, src.sy, src.sw, src.sh)
  surface.setTransform(a, b, c, d, e - originX, f - originY)
  transformByChrome(surface, chrome)
  draw(surface)
  surface.restore()
  context.backend.drawImageQuad({ image: surface.canvas, src, dw: layer.w, dh: layer.h, cornerRadius: 0 }, { ...chrome, ...blitPlacement(grid, layer) })
}

export const renderMulticam: ElementRenderer<MulticamElement> = (element, context) => {
  const frames = context.source
  if (!frames) return
  const { project, timeMs, viewTimeMs } = context
  const groupMs = getMulticamGroupTimeMs(element, timeMs)
  const transition = getAngleTransitionAt(element, groupMs)
  const layouts = transition
    ? [getLayout(project.layouts, transition.fromLayoutId), getLayout(project.layouts, transition.toLayoutId)]
    : [getActiveLayout(project, element, timeMs)]
  if (!layouts.some(Boolean)) return
  const pictureOf = (source: MulticamSource): Picture | null => {
    const image = frames.getFrame(source.assetId, getMulticamSourceTimeMs(element, source, timeMs))
    if (!image) return null
    const { width, height } = getImageSize(image)
    return width > 0 && height > 0 ? { image, width, height } : null
  }
  const [left = [], right = []] = layouts.map((layout) => (layout ? placeLayout(project, element, layout, timeMs, viewTimeMs, pictureOf) : []))
  const composite = placeComposite(
    project,
    element,
    viewTimeMs,
    [...left, ...right].map(({ box }) => box),
  )
  const chrome = chromeOf(project, element)
  const drawFraming = (draw: (ctx: Canvas2D) => void) => {
    const { ctx } = context
    applyChrome(ctx, chrome, () => draw(ctx))
  }
  const { shadow, stroke } = element
  if (shadow) drawFraming((ctx) => drawFrameShadow(ctx, shadow, composite.bounds, composite.radius))
  drawLayer(context, chrome, composite.bounds, (surface) => {
    const drawLayout = (slots: readonly PlacedSlot[]) => {
      applySteps(surface, composite.zoom)
      for (const { style, box, image, src, dest } of slots) {
        withFrameChrome(surface, style, box, () => surface.drawImage(image, src.sx, src.sy, src.sw, src.sh, dest.x, dest.y, dest.w, dest.h))
      }
    }
    applySteps(surface, composite.frame)
    if (!transition) {
      drawLayout(left)
      return
    }
    const { width, height } = project
    const centered = (slots: readonly PlacedSlot[]) => () => {
      surface.save()
      surface.translate(width / 2, height / 2)
      drawLayout(slots)
      surface.restore()
    }
    const pair = { left: element, right: element, cutMs: transition.cutMs, durationMs: transition.durationMs, type: transition.type }
    surface.translate(-width / 2, -height / 2)
    transitionRenderers[transition.type]({
      ctx: surface,
      project,
      pair,
      timeMs: groupMs,
      completion: getTransitionCompletion(pair, groupMs),
      drawLeft: centered(left),
      drawRight: centered(right),
    })
  })
  if (stroke) drawFraming((ctx) => drawFrameStroke(ctx, stroke, composite.bounds, composite.radius))
}
