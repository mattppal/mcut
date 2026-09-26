import {
  getClipView,
  getSourceTimeMs,
  type MulticamElement,
  type BlendMode,
  type CaptionElement,
  type ContentView,
  type Effect,
  type ElementType,
  type FrameStyle,
  type ImageElement,
  type TextElement,
  type TimelineElement,
  type Transform,
  type VideoElement,
} from '@mcut/timeline'
import { applyChrome, type LayerChrome } from './backend'
import { drawFramedMedia, frameRadius, getImageSize, viewSourceRect } from './framed-media'
import { toCanvasPoint } from './geometry'
import { getCaptionLane } from './caption-lane'
import { composeMulticam } from './multicam'
import { reframedCrop } from './reframe-views'
import { buildFont, layoutCaption, layoutTextBlock, type MeasureFn } from './text'
import type { Canvas2D, ElementRenderContext, ElementRenderer } from './types'

type ElementByType = { [K in ElementType]: Extract<TimelineElement, { type: K }> }

// Canvas letterSpacing is not implemented in every engine, see https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing#browser_compatibility
function setLetterSpacing(ctx: Canvas2D, px: number): void {
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${px}px`
  }
}

function measureWith(ctx: Canvas2D): MeasureFn {
  return (text, font, letterSpacingPx) => {
    ctx.font = font
    setLetterSpacing(ctx, letterSpacingPx ?? 0)
    return ctx.measureText(text).width
  }
}

interface VisualChrome {
  transform: Transform
  opacity: number
  effects?: Effect[] | undefined
  blendMode?: BlendMode | undefined
}

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

function withTransform(ctx: Canvas2D, context: ElementRenderContext, element: VisualChrome, draw: () => void): void {
  applyChrome(ctx, chromeOf(context, element), draw)
}

function drawMediaFrame(
  context: ElementRenderContext,
  element: VisualChrome & FrameStyle,
  frame: CanvasImageSource,
  dw: number,
  dh: number,
  view: ContentView,
): void {
  const box = { x: -dw / 2, y: -dh / 2, w: dw, h: dh }
  if (!element.stroke && !element.shadow) {
    context.backend.drawImageQuad(
      { image: frame, src: viewSourceRect(element.crop, frame, view), dw, dh, cornerRadius: frameRadius(element, box) },
      chromeOf(context, element),
    )
    return
  }
  const ctx = context.ctx
  withTransform(ctx, context, element, () => drawFramedMedia(ctx, frame, box, element, 'fill', () => view))
}

const renderVideo: ElementRenderer<VideoElement> = (element, context) => {
  if (!context.source) return
  const sourceTimeMs = Math.max(0, getSourceTimeMs(element, context.timeMs - element.startMs))
  const frame = context.source.getFrame(element.assetId, sourceTimeMs)
  if (!frame) return
  const asset = context.project.assets[element.assetId]
  const { width, height } = asset?.width && asset?.height ? { width: asset.width, height: asset.height } : getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const dw = width * (element.crop?.w ?? 1)
  const dh = height * (element.crop?.h ?? 1)
  drawMediaFrame(context, { ...element, crop: reframedCrop(element, context.timeMs) }, frame, dw, dh, getClipView(element, context.viewTimeMs))
}

const renderImage: ElementRenderer<ImageElement> = (element, context) => {
  if (!context.source) return
  const frame = context.source.getFrame(element.assetId, 0)
  if (!frame) return
  const { width, height } = getImageSize(frame)
  if (width <= 0 || height <= 0) return
  const dw = width * (element.crop?.w ?? 1)
  const dh = height * (element.crop?.h ?? 1)
  drawMediaFrame(context, { ...element, crop: reframedCrop(element, context.timeMs) }, frame, dw, dh, getClipView(element, context.viewTimeMs))
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
      ctx.roundRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height, element.style.fontSize * 0.15)
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
    for (const [i, line] of layout.lines.entries()) {
      const y = -layout.height / 2 + layout.padding + layout.lineHeight * (i + 0.5)
      if (line.segments) {
        ctx.textAlign = 'left'
        let x = style.align === 'left' ? -innerWidth / 2 : style.align === 'right' ? innerWidth / 2 - line.width : -line.width / 2
        for (const segment of line.segments) {
          ctx.font = segment.font
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
  const padX = style.fontSize * 0.4
  const lane = getCaptionLane(project, timeMs, style.position, padX)
  const layout = layoutCaption(measureWith(ctx), element, style, lane.maxWidth)
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
  const padY = style.fontSize * 0.18

  ctx.save()
  ctx.font = layout.font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  for (const [i, line] of layout.lines.entries()) {
    const lineLeft = lane.centerX - line.width / 2
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
      const isActive = word.startMs !== undefined && word.endMs !== undefined && relativeMs >= word.startMs && relativeMs < word.endMs
      ctx.fillStyle = isActive && style.activeWordColor !== undefined ? style.activeWordColor : style.color
      ctx.fillText(word.text, lineLeft + word.x, lineCenterY)
    }
  }
  ctx.restore()
}

const renderMulticam: ElementRenderer<MulticamElement> = (element, context) => {
  const frames = context.source
  if (!frames) return
  const surface = composeMulticam(element, context, frames)
  if (!surface) return
  const { width, height } = context.project
  drawMediaFrame(context, element, surface.canvas, width * (element.crop?.w ?? 1), height * (element.crop?.h ?? 1), getClipView(element, context.viewTimeMs))
}

export const elementRenderers: { readonly [K in ElementType]: ElementRenderer<ElementByType[K]> } = {
  video: renderVideo,
  multicam: renderMulticam,
  image: renderImage,
  text: renderText,
  caption: renderCaption,
  audio: () => {},
}

function renderTyped<K extends ElementType>(type: K, element: ElementByType[K], context: ElementRenderContext): void {
  elementRenderers[type](element, context)
}

export const renderElementLayer: ElementRenderer = (element, context) => renderTyped(element.type, element, context)

export { measureWith }
