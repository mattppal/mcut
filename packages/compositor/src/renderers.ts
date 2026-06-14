import {
  getActiveLayout,
  getAngleTransitionAt,
  getLayout,
  getMulticamSourceTimeMs,
  getSourceTimeMs,
  getTransitionCompletion,
  type MulticamElement,
  type BlendMode,
  type CaptionElement,
  type Crop,
  type Effect,
  type ImageElement,
  type Layout,
  type Shadow,
  type Stroke,
  type TextElement,
  type TimelineElement,
  type Transform,
  type VideoElement,
} from '@mcut/timeline'
import { applyChrome, type LayerChrome } from './backend'
import { toCanvasPoint } from './geometry'
import { getTransitionRenderer } from './transition-renderers'
import { buildFont, layoutCaption, layoutTextBlock, type MeasureFn } from './text'
import type { Canvas2D, ElementRenderContext, ElementRenderer } from './types'

const renderers = new Map<string, ElementRenderer>()

/**
 * Register a renderer for an element type. Built-in types can be overridden;
 * custom element types (added via custom commands) plug in here — the
 * compositor side of the engine's command registry.
 */
export function registerElementRenderer<E extends TimelineElement>(
  type: E['type'] | (string & {}),
  renderer: ElementRenderer<E>,
): void {
  renderers.set(type, renderer as ElementRenderer)
}

export function getElementRenderer(type: string): ElementRenderer | undefined {
  return renderers.get(type)
}

/**
 * `letterSpacing` shipped in Chromium 99+/Safari 17 but is still missing from
 * some engines (and OffscreenCanvas typings); feature-detect and degrade to
 * no tracking — measurement and drawing stay consistent either way.
 */
function setLetterSpacing(ctx: Canvas2D, px: number): void {
  if ('letterSpacing' in ctx) {
    ;(ctx as { letterSpacing: string }).letterSpacing = `${px}px`
  }
}

function measureWith(ctx: Canvas2D): MeasureFn {
  return (text, font, letterSpacingPx) => {
    ctx.font = font
    setLetterSpacing(ctx, letterSpacingPx ?? 0)
    return ctx.measureText(text).width
  }
}

export function getImageSize(source: CanvasImageSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight }
  }
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight }
  }
  const maybe = source as { width?: number | { baseVal: { value: number } }; height?: number | { baseVal: { value: number } } }
  const width = typeof maybe.width === 'number' ? maybe.width : (maybe.width?.baseVal.value ?? 0)
  const height = typeof maybe.height === 'number' ? maybe.height : (maybe.height?.baseVal.value ?? 0)
  return { width, height }
}

interface VisualChrome {
  transform: Transform
  opacity: number
  effects?: Effect[] | undefined
  blendMode?: BlendMode | undefined
}

/** Resolve an element's visual chrome to frame coordinates (backend input). */
function chromeOf(context: ElementRenderContext, element: VisualChrome): LayerChrome {
  const center = toCanvasPoint(context.project, element.transform.x, element.transform.y)
  return {
    centerX: center.x,
    centerY: center.y,
    rotationDeg: element.transform.rotation,
    scaleX: element.transform.scaleX,
    scaleY: element.transform.scaleY,
    opacity: element.opacity,
    blendMode: element.blendMode,
    effects: element.effects,
  }
}

/**
 * Transform + opacity + effect-stack filter + blend mode around a canvas2d
 * draw (see backend.ts `applyChrome` for the actual state handling).
 */
function withTransform(
  ctx: Canvas2D,
  context: ElementRenderContext,
  element: VisualChrome,
  draw: () => void,
): void {
  applyChrome(ctx, chromeOf(context, element), draw)
}

interface FrameStyle {
  cornerRadius?: number | undefined
  stroke?: Stroke | undefined
  shadow?: Shadow | undefined
}

/**
 * Frame chrome around a centered `dw`×`dh` media draw: drop shadow behind
 * the rounded rect, rounded clip on the content, inside border on top — the
 * layout-slot look, available as element-level fields (style.ts primitives).
 * Strokes paint INSIDE the bounds (clip + doubled width) so the frame's
 * geometry — and every snap/handle derived from it — stays exact.
 */
function withFrameChrome(
  ctx: Canvas2D,
  style: FrameStyle,
  dw: number,
  dh: number,
  draw: () => void,
): void {
  const radius = (style.cornerRadius ?? 0) * Math.min(dw, dh)
  const tracePath = () => {
    ctx.beginPath()
    ctx.roundRect(-dw / 2, -dh / 2, dw, dh, radius)
  }
  if (style.shadow) {
    ctx.save()
    ctx.shadowColor = style.shadow.color
    ctx.shadowBlur = style.shadow.blur
    ctx.shadowOffsetX = style.shadow.offsetX
    ctx.shadowOffsetY = style.shadow.offsetY
    ctx.fillStyle = '#000'
    tracePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  if (radius > 0) {
    tracePath()
    ctx.clip()
  }
  draw()
  ctx.restore()
  if (style.stroke) {
    ctx.save()
    tracePath()
    ctx.clip()
    ctx.strokeStyle = style.stroke.color
    ctx.lineWidth = style.stroke.width * 2
    tracePath()
    ctx.stroke()
    ctx.restore()
  }
}

/** Source rect for a crop mask, in the actual frame's pixel space. */
function cropSourceRect(
  crop: Crop | undefined,
  frame: CanvasImageSource,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (!crop) return null
  // Frame sources may serve downscaled stand-ins; crop is normalized, so
  // map it to the served frame's pixels rather than the asset's.
  const { width: fw, height: fh } = getImageSize(frame)
  if (fw <= 0 || fh <= 0) return null
  return { sx: crop.x * fw, sy: crop.y * fh, sw: crop.w * fw, sh: crop.h * fh }
}

/**
 * Composite a media frame: the plain case (no stroke/shadow chrome) goes
 * through the backend's structured quad path — on GPU backends that is the
 * zero-copy fast path with WGSL effects — while framed draws keep the
 * canvas2d chrome (shadow + rounded clip + inside border) on the raster
 * surface.
 */
function drawMediaFrame(
  context: ElementRenderContext,
  element: VisualChrome & FrameStyle & { crop?: Crop | undefined },
  frame: CanvasImageSource,
  dw: number,
  dh: number,
): void {
  const src = cropSourceRect(element.crop, frame)
  if (!element.stroke && !element.shadow) {
    context.backend.drawImageQuad(
      {
        image: frame,
        src,
        dw,
        dh,
        cornerRadius: (element.cornerRadius ?? 0) * Math.min(dw, dh),
      },
      chromeOf(context, element),
    )
    return
  }
  const ctx = context.ctx
  withTransform(ctx, context, element, () => {
    withFrameChrome(ctx, element, dw, dh, () => {
      if (src) {
        ctx.drawImage(frame, src.sx, src.sy, src.sw, src.sh, -dw / 2, -dh / 2, dw, dh)
      } else {
        ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh)
      }
    })
  })
}

const renderVideo: ElementRenderer<VideoElement> = (element, context) => {
  if (!context.source) return
  // Shared output→source mapping (handles timeMap speed/ramps/freezes).
  // Clamped ≥ 0: transition pre-roll can map before the source's start.
  const sourceTimeMs = Math.max(0, getSourceTimeMs(element, context.timeMs - element.startMs))
  const frame = context.source.getFrame(element.assetId, sourceTimeMs)
  if (!frame) return
  // Draw at the asset's probed size, not the frame's: frame sources may serve
  // downscaled stand-ins (e.g. the preview scrub cache mid-seek), and geometry
  // (selection OBB, fit-to-frame) already sizes the element from the asset.
  const asset = context.project.assets[element.assetId]
  const { width, height } =
    asset?.width && asset?.height ? { width: asset.width, height: asset.height } : getImageSize(frame)
  if (width <= 0 || height <= 0) return
  // A crop mask shrinks the frame to the kept region (geometry.ts agrees).
  const dw = width * (element.crop?.w ?? 1)
  const dh = height * (element.crop?.h ?? 1)
  drawMediaFrame(context, element, frame, dw, dh)
}

const renderImage: ElementRenderer<ImageElement> = (element, context) => {
  if (!context.source) return
  const frame = context.source.getFrame(element.assetId, 0)
  if (!frame) return
  const { width, height } = getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const dw = width * (element.crop?.w ?? 1)
  const dh = height * (element.crop?.h ?? 1)
  drawMediaFrame(context, element, frame, dw, dh)
}

const renderText: ElementRenderer<TextElement> = (element, context) => {
  const { ctx } = context
  const layout = layoutTextBlock(measureWith(ctx), element.text, element.style, {
    box: element.box,
    ...(element.runs ? { runs: element.runs } : {}),
  })
  withTransform(ctx, context, element, () => {
    if (element.style.backgroundColor) {
      ctx.fillStyle = element.style.backgroundColor
      ctx.beginPath()
      ctx.roundRect(
        -layout.width / 2,
        -layout.height / 2,
        layout.width,
        layout.height,
        element.style.fontSize * 0.15,
      )
      ctx.fill()
    }
    if (layout.overflow === 'clip') {
      ctx.beginPath()
      ctx.rect(-layout.width / 2, -layout.height / 2, layout.width, layout.height)
      ctx.clip()
    }
    const { style } = element
    ctx.font = layout.font
    setLetterSpacing(ctx, style.letterSpacing ?? 0)
    ctx.textBaseline = 'middle'
    const stroke = style.stroke && style.stroke.width > 0 ? style.stroke : null
    if (stroke) {
      // Outline look: stroke painted UNDER the fill, so only half the (2x)
      // line width shows outside the glyph. Round joins avoid miter spikes.
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width * 2
      ctx.lineJoin = 'round'
    }
    const innerWidth = Math.max(1, layout.width - layout.padding * 2)
    const setShadow = () => {
      if (!style.shadow) return
      ctx.shadowColor = style.shadow.color
      ctx.shadowBlur = style.shadow.blur
      ctx.shadowOffsetX = style.shadow.offsetX
      ctx.shadowOffsetY = style.shadow.offsetY
    }
    const clearShadow = () => {
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0
    }
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i]!
      const y = -layout.height / 2 + layout.padding + layout.lineHeight * (i + 0.5)
      if (line.segments) {
        // Rich-text runs: paint left-to-right with each segment's own font
        // and fill. Stroke/shadow stay base-style (uniform across the line).
        ctx.textAlign = 'left'
        let x =
          style.align === 'left'
            ? -innerWidth / 2
            : style.align === 'right'
              ? innerWidth / 2 - line.width
              : -line.width / 2
        for (const segment of line.segments) {
          ctx.font = segment.font
          // The shadow rides on the bottom paint pass only (the stroke when
          // one exists, else the fill), so passes don't double the shadow.
          setShadow()
          if (stroke) {
            ctx.strokeText(segment.text, x, y)
            clearShadow()
          }
          ctx.fillStyle = segment.color ?? style.color
          ctx.fillText(segment.text, x, y)
          if (style.shadow && !stroke) clearShadow()
          x += segment.width
        }
        ctx.font = layout.font
        continue
      }
      let x: number
      if (style.align === 'left') {
        ctx.textAlign = 'left'
        x = -innerWidth / 2
      } else if (style.align === 'right') {
        ctx.textAlign = 'right'
        x = innerWidth / 2
      } else {
        ctx.textAlign = 'center'
        x = 0
      }
      // The shadow rides on the bottom paint pass only (the stroke when one
      // exists, else the fill), so stroke + fill don't double the shadow.
      setShadow()
      if (stroke) {
        ctx.strokeText(line.text, x, y)
        clearShadow()
      }
      ctx.fillStyle = style.color
      ctx.fillText(line.text, x, y)
      if (style.shadow && !stroke) clearShadow()
    }
  })
}

const renderCaption: ElementRenderer<CaptionElement> = (element, context) => {
  const { ctx, project, timeMs } = context
  const style = element.style
  const maxWidth = project.width * 0.85
  const layout = layoutCaption(measureWith(ctx), element, style, maxWidth)
  if (layout.lines.length === 0) return

  const blockHeight = layout.lines.length * layout.lineHeight
  let blockTop: number
  if (style.position === 'top') {
    blockTop = project.height * 0.08
  } else if (style.position === 'middle') {
    blockTop = project.height / 2 - blockHeight / 2
  } else {
    blockTop = project.height * 0.92 - blockHeight
  }

  const relativeMs = timeMs - element.startMs
  const padX = style.fontSize * 0.4
  const padY = style.fontSize * 0.18

  ctx.save()
  ctx.font = layout.font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!
    const lineLeft = project.width / 2 - line.width / 2
    const lineCenterY = blockTop + layout.lineHeight * (i + 0.5)

    if (style.backgroundColor) {
      ctx.fillStyle = style.backgroundColor
      ctx.beginPath()
      ctx.roundRect(
        lineLeft - padX,
        lineCenterY - layout.lineHeight / 2 + (layout.lineHeight - style.fontSize) / 2 - padY,
        line.width + padX * 2,
        style.fontSize + padY * 2,
        style.fontSize * 0.15,
      )
      ctx.fill()
    }

    for (const word of line.words) {
      const isActive =
        style.activeWordColor !== undefined &&
        word.startMs !== undefined &&
        word.endMs !== undefined &&
        relativeMs >= word.startMs &&
        relativeMs < word.endMs
      ctx.fillStyle = isActive ? style.activeWordColor! : style.color
      ctx.fillText(word.text, lineLeft + word.x, lineCenterY)
    }
  }
  ctx.restore()
}

/**
 * Multicam: composes the sources of the ACTIVE layout (the cut under the
 * playhead) into normalized slot rects — cover/contain crop via 9-arg
 * drawImage, rounded clip, optional drop shadow. Same renderer for preview
 * and export; decode parity comes from getFrameRequests.
 */
const renderMulticam: ElementRenderer<MulticamElement> = (element, context) => {
  if (!context.source) return
  const { ctx, project } = context
  const W = project.width
  const H = project.height

  const drawLayout = (layout: Layout | null) => {
    if (!layout) return
    withTransform(ctx, context, element, () => {
      for (const slot of layout.slots) {
        const source = element.sources.find((s) => s.key === slot.source)
        if (!source) continue
        const sourceTimeMs = getMulticamSourceTimeMs(element, source, context.timeMs)
        const frame = context.source!.getFrame(source.assetId, sourceTimeMs)
        if (!frame) continue
        const { width: fw, height: fh } = getImageSize(frame)
        if (fw <= 0 || fh <= 0) continue

        // Slot rect in element-local (center-origin) pixels.
        const rx = (slot.rect.x - 0.5) * W
        const ry = (slot.rect.y - 0.5) * H
        const rw = slot.rect.w * W
        const rh = slot.rect.h * H
        const radius = slot.cornerRadius * Math.min(rw, rh)

        if (slot.shadow) {
          ctx.save()
          ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
          ctx.shadowBlur = Math.min(rw, rh) * 0.12
          ctx.shadowOffsetY = Math.min(rw, rh) * 0.04
          ctx.fillStyle = '#000'
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, radius)
          ctx.fill()
          ctx.restore()
        }

        // cover: crop the source to fill; contain: letterbox inside the rect.
        // The slot's focus picks which part of the source the cover crop keeps.
        const scale =
          slot.fit === 'cover' ? Math.max(rw / fw, rh / fh) : Math.min(rw / fw, rh / fh)
        const sw = Math.min(fw, rw / scale)
        const sh = Math.min(fh, rh / scale)
        const sx = (fw - sw) * (slot.focus?.x ?? 0.5)
        const sy = (fh - sh) * (slot.focus?.y ?? 0.5)
        const dw = sw * scale
        const dh = sh * scale
        const dx = rx + (rw - dw) / 2
        const dy = ry + (rh - dh) / 2

        ctx.save()
        if (radius > 0) {
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, radius)
          ctx.clip()
        }
        ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh)
        ctx.restore()

        if (slot.stroke) {
          // Inside border (clip + doubled width), same as element frames.
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, radius)
          ctx.clip()
          ctx.strokeStyle = slot.stroke.color
          ctx.lineWidth = slot.stroke.width * 2
          ctx.beginPath()
          ctx.roundRect(rx, ry, rw, rh, radius)
          ctx.stroke()
          ctx.restore()
        }
      }
    })
  }

  // Inside an angle-cut blend window the outgoing and incoming layouts mix
  // through the SAME transition renderers clips use — the multicam plays
  // both sides of the pair, with the cut mapped to absolute time.
  const window = getAngleTransitionAt(element, context.timeMs - element.startMs)
  if (window) {
    const renderer = getTransitionRenderer(window.type)
    if (renderer) {
      const pair = {
        left: element,
        right: element,
        cutMs: element.startMs + window.cutMs,
        durationMs: window.durationMs,
        type: window.type,
      }
      renderer({
        ctx,
        project,
        pair,
        timeMs: context.timeMs,
        completion: getTransitionCompletion(pair, context.timeMs),
        drawLeft: () => drawLayout(getLayout(project.layouts, window.fromLayoutId)),
        drawRight: () => drawLayout(getLayout(project.layouts, window.toLayoutId)),
      })
      return
    }
  }

  drawLayout(getActiveLayout(project, element, context.timeMs))
}

registerElementRenderer<VideoElement>('video', renderVideo)
registerElementRenderer<MulticamElement>('multicam', renderMulticam)
registerElementRenderer<ImageElement>('image', renderImage)
registerElementRenderer<TextElement>('text', renderText)
registerElementRenderer<CaptionElement>('caption', renderCaption)
// Audio has no visual representation.
registerElementRenderer('audio', () => {})

export { buildFont, measureWith }
