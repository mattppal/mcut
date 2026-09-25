export {
  degToRad,
  fromCanvasPoint,
  getElementDisplaySize,
  getElementNaturalSize,
  getElementOBB,
  getFitScale,
  getTransformForDisplaySize,
  getHandles,
  hitTestHandles,
  hitTestOBB,
  ROTATE_HANDLE_OFFSET,
  toCanvasPoint,
  type DisplaySizePatch,
  type ElementSize,
  type Handle,
  type HandleId,
  type OBB,
  type SizeHelpers,
} from './geometry'

export { renderFrame, renderFrameWith } from './render-frame'

export { applyChrome, Canvas2DBackend, createElementContext, drawImageQuad2D, type ImageQuad, type LayerChrome, type RenderBackend } from './backend'

export { isWebGPUSupported, WebGPUBackend, type WebGPUBackendOptions } from './webgpu/webgpu-backend'

export { curveToLut, hasUnsupportedEffects, planEffects, type ColorOp, type EffectPass, type EffectPlan } from './webgpu/effect-plan'

export { transitionRenderers, type TransitionRenderContext, type TransitionRenderer } from './transition-renderers'

export { getImageSize } from './framed-media'

export { elementRenderers, measureWith, renderElementLayer } from './renderers'

export {
  applyTextTransform,
  buildFont,
  layoutCaption,
  layoutTextBlock,
  type CaptionLayout,
  type CaptionWordBox,
  type MeasureFn,
  type TextBlockLayout,
} from './text'

export type { Canvas2D, ElementRenderContext, ElementRenderer, FrameSource, RenderFrameOptions } from './types'
