import {
  applyChrome,
  drawImageQuad2D,
  type ImageQuad,
  type LayerChrome,
  type RenderBackend,
} from '../backend'
import { getImageSize } from '../renderers'
import type { Canvas2D } from '../types'
import { parseCssColor } from './color'
import { planEffects, type EffectPass, type EffectPlan } from './effect-plan'
import {
  BLEND_MODE_IDS,
  BLUR_SHADER,
  COLOR_SHADER,
  COMPOSITE_SHADER,
  LUT3D_SHADER,
  PREPARE_SHADER,
  PRESENT_SHADER,
  SHADOW_SHADER,
} from './shaders'
import { gaussianKernel, invertChrome } from './transform'
import '../gpu-effects'

/**
 * The WebGPU compositor backend. Image quads (video/image elements)
 * composite as full-frame passes over a ping-pong texture pair —
 * `importExternalTexture` keeps `VideoFrame`s zero-copy — with effects as
 * WGSL passes and every blend mode in one shader (mode uniform). Raster
 * content (text, captions, multicam chrome, transitions, custom renderers)
 * still paints through canvas2d in frame space and uploads as a texture
 * layer in z-order, so output matches the reference Canvas2D backend.
 *
 * Lifecycle: `WebGPUBackend.create({ canvas, width, height })` once, then
 * `renderFrameWith(backend, project, timeMs, options)` per frame, `resize`
 * on project dimension changes, `dispose` when done. For export, pass the
 * GPUTexture-backed canvas straight to Mediabunny's CanvasSource — no CPU
 * readback.
 */

export interface WebGPUBackendOptions {
  /** Presentation canvas; the backend configures its 'webgpu' context. */
  canvas: HTMLCanvasElement | OffscreenCanvas
  /** Project (composition) size — passes render at this resolution. */
  width: number
  height: number
  /** Bring your own device (tests/sharing); otherwise adapter-requested. */
  device?: GPUDevice
}

/** Whether this runtime exposes WebGPU at all (Chrome 113+/Safari 26+/Firefox 141+). */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu
}

interface PooledTexture {
  texture: GPUTexture
  width: number
  height: number
  inUse: boolean
}

const FORMAT: GPUTextureFormat = 'rgba8unorm'

// Spec bit-flag constants: the GPUTextureUsage/GPUBufferUsage value globals
// are runtime-only (lib.dom declares the types but not the namespaces).
const TEXTURE_USAGE = {
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  RENDER_ATTACHMENT: 0x10,
} as const
const BUFFER_USAGE = {
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const

export class WebGPUBackend implements RenderBackend {
  readonly kind = 'webgpu'
  readonly width: number
  readonly height: number

  private readonly device: GPUDevice
  private readonly context: GPUCanvasContext
  private readonly presentationFormat: GPUTextureFormat

  // Ping-pong accumulation at project resolution.
  private acc: [GPUTexture, GPUTexture]
  private accIndex = 0

  // Raster surface for canvas2d content, composited lazily in z-order.
  private readonly rasterCanvas: OffscreenCanvas
  private readonly rasterCtx: Canvas2D
  private rasterDirty = false
  private rasterScope = 0

  private readonly sampler: GPUSampler
  private readonly pipelines: {
    composite: GPURenderPipeline
    prepare2d: GPURenderPipeline
    prepareExternal: GPURenderPipeline
    color: GPURenderPipeline
    blur: GPURenderPipeline
    shadow: GPURenderPipeline
    lut3d: GPURenderPipeline
    present: GPURenderPipeline
  }

  private readonly texturePool: PooledTexture[] = []
  private frameBuffers: GPUBuffer[] = []
  private readonly identityCurves: GPUTexture
  private readonly luts = new Map<string, { texture: GPUTexture; size: number }>()

  static async create(options: WebGPUBackendOptions): Promise<WebGPUBackend> {
    let device = options.device
    if (!device) {
      if (!isWebGPUSupported()) throw new Error('WebGPU is not available in this browser')
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) throw new Error('No WebGPU adapter available')
      device = await adapter.requestDevice()
    }
    return new WebGPUBackend(device, options)
  }

  private constructor(device: GPUDevice, options: WebGPUBackendOptions) {
    this.device = device
    this.width = options.width
    this.height = options.height

    const context = options.canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) throw new Error('Could not create a webgpu canvas context')
    this.context = context
    this.presentationFormat =
      typeof navigator !== 'undefined' && navigator.gpu
        ? navigator.gpu.getPreferredCanvasFormat()
        : FORMAT
    context.configure({ device, format: this.presentationFormat, alphaMode: 'opaque' })

    this.rasterCanvas = new OffscreenCanvas(this.width, this.height)
    const rasterCtx = this.rasterCanvas.getContext('2d')
    if (!rasterCtx) throw new Error('Could not create the raster scratch context')
    this.rasterCtx = rasterCtx as Canvas2D

    this.acc = [this.createAccTexture(), this.createAccTexture()]
    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    const fullscreen = (code: string, format: GPUTextureFormat): GPURenderPipeline => {
      const module = device.createShaderModule({ code })
      return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs_main' },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
    }

    this.pipelines = {
      composite: fullscreen(COMPOSITE_SHADER, FORMAT),
      prepare2d: fullscreen(PREPARE_SHADER(false), FORMAT),
      prepareExternal: fullscreen(PREPARE_SHADER(true), FORMAT),
      color: fullscreen(COLOR_SHADER, FORMAT),
      blur: fullscreen(BLUR_SHADER, FORMAT),
      shadow: fullscreen(SHADOW_SHADER, FORMAT),
      lut3d: fullscreen(LUT3D_SHADER, FORMAT),
      present: fullscreen(PRESENT_SHADER, this.presentationFormat),
    }

    // Identity curves LUT so the color pipeline always has a binding.
    this.identityCurves = device.createTexture({
      size: { width: 256, height: 1 },
      format: FORMAT,
      usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
    })
    const identity = new Uint8Array(256 * 4)
    for (let i = 0; i < 256; i++) {
      identity[i * 4] = i
      identity[i * 4 + 1] = i
      identity[i * 4 + 2] = i
      identity[i * 4 + 3] = 255
    }
    device.queue.writeTexture(
      { texture: this.identityCurves },
      identity,
      { bytesPerRow: 256 * 4 },
      { width: 256, height: 1 },
    )
  }

  /**
   * Register a 3D LUT for `lut3d` effects: `data` is size³ RGB triples
   * (0..1, red fastest), flattened to a (size² × size) 2D texture.
   */
  registerLut3D(lutId: string, size: number, data: Float32Array): void {
    if (data.length < size * size * size * 3) throw new Error('LUT data is too short for its size')
    const width = size * size
    const bytes = new Uint8Array(width * size * 4)
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const src = ((b * size + g) * size + r) * 3
          const dst = (g * width + b * size + r) * 4
          bytes[dst] = Math.round(Math.min(1, Math.max(0, data[src]!)) * 255)
          bytes[dst + 1] = Math.round(Math.min(1, Math.max(0, data[src + 1]!)) * 255)
          bytes[dst + 2] = Math.round(Math.min(1, Math.max(0, data[src + 2]!)) * 255)
          bytes[dst + 3] = 255
        }
      }
    }
    const texture = this.device.createTexture({
      size: { width, height: size },
      format: FORMAT,
      usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST,
    })
    this.device.queue.writeTexture(
      { texture },
      bytes,
      { bytesPerRow: width * 4 },
      { width, height: size },
    )
    this.luts.get(lutId)?.texture.destroy()
    this.luts.set(lutId, { texture, size })
  }

  // -------------------------------------------------------------------------
  // RenderBackend
  // -------------------------------------------------------------------------

  beginFrame(backgroundColor: string): void {
    const [r, g, b] = parseCssColor(backgroundColor)
    this.accIndex = 0
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.acc[0]!.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r, g, b, a: 1 },
        },
      ],
    })
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  endFrame(): void {
    this.flushRaster()
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })
    pass.setPipeline(this.pipelines.present)
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: this.pipelines.present.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.acc[this.accIndex]!.createView() },
          { binding: 1, resource: this.sampler },
        ],
      }),
    )
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])

    for (const buffer of this.frameBuffers) buffer.destroy()
    this.frameBuffers = []
    for (const pooled of this.texturePool) pooled.inUse = false
  }

  acquireRaster(): Canvas2D {
    this.rasterDirty = true
    return this.rasterCtx
  }

  pushRasterScope(): void {
    this.rasterScope++
  }

  popRasterScope(): void {
    this.rasterScope = Math.max(0, this.rasterScope - 1)
  }

  drawImageQuad(quad: ImageQuad, chrome: LayerChrome): void {
    if (chrome.opacity <= 0) return
    const plan = planEffects(chrome.effects)
    if (this.rasterScope > 0 || plan.unsupported) {
      // Canvas2d-correct fallback: transition scopes need the caller's
      // canvas state; raw `css` filters only exist there.
      const ctx = this.acquireRaster()
      applyChrome(ctx, chrome, () => drawImageQuad2D(ctx, quad))
      return
    }
    const inverse = invertChrome(chrome)
    if (inverse.degenerate) return

    this.flushRaster()
    try {
      this.drawQuadOnGpu(quad, chrome, plan, inverse)
    } catch {
      // Source not GPU-importable (rare: SVG images, detached frames) —
      // the raster path always works.
      const ctx = this.acquireRaster()
      applyChrome(ctx, chrome, () => drawImageQuad2D(ctx, quad))
    }
  }

  /** Free GPU resources. The backend is unusable afterwards. */
  dispose(): void {
    for (const pooled of this.texturePool) pooled.texture.destroy()
    this.texturePool.length = 0
    for (const buffer of this.frameBuffers) buffer.destroy()
    this.frameBuffers = []
    this.acc[0]!.destroy()
    this.acc[1]!.destroy()
    this.identityCurves.destroy()
    for (const { texture } of this.luts.values()) texture.destroy()
    this.luts.clear()
    this.context.unconfigure()
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private createAccTexture(): GPUTexture {
    return this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: FORMAT,
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.TEXTURE_BINDING,
    })
  }

  private acquireTexture(width: number, height: number): GPUTexture {
    const found = this.texturePool.find(
      (p) => !p.inUse && p.width === width && p.height === height,
    )
    if (found) {
      found.inUse = true
      return found.texture
    }
    const texture = this.device.createTexture({
      size: { width, height },
      format: FORMAT,
      usage:
        TEXTURE_USAGE.RENDER_ATTACHMENT |
        TEXTURE_USAGE.TEXTURE_BINDING |
        TEXTURE_USAGE.COPY_DST,
    })
    this.texturePool.push({ texture, width, height, inUse: true })
    return texture
  }

  private releaseTexture(texture: GPUTexture): void {
    const pooled = this.texturePool.find((p) => p.texture === texture)
    if (pooled) pooled.inUse = false
  }

  private uniformBuffer(data: ArrayBuffer): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
      usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    })
    this.device.queue.writeBuffer(buffer, 0, data)
    this.frameBuffers.push(buffer)
    return buffer
  }

  private storageBuffer(data: Float32Array): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
      usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST,
    })
    this.device.queue.writeBuffer(buffer, 0, data)
    this.frameBuffers.push(buffer)
    return buffer
  }

  /** Upload the raster scratch and composite it as a normal full-frame layer. */
  private flushRaster(): void {
    if (!this.rasterDirty) return
    this.rasterDirty = false
    const texture = this.acquireTexture(this.width, this.height)
    this.device.queue.copyExternalImageToTexture(
      { source: this.rasterCanvas },
      { texture, premultipliedAlpha: true },
      { width: this.width, height: this.height },
    )
    this.compositeFullFrame(texture, { identity: true, opacity: 1, mode: 0 })
    this.releaseTexture(texture)
    this.rasterCtx.clearRect(0, 0, this.width, this.height)
  }

  private drawQuadOnGpu(
    quad: ImageQuad,
    chrome: LayerChrome,
    plan: EffectPlan,
    inverse: ReturnType<typeof invertChrome>,
  ): void {
    // Layer texture at the destination's intrinsic size (pre chrome scale).
    const limits = this.device.limits.maxTextureDimension2D
    const lw = Math.max(1, Math.min(limits, Math.round(quad.dw)))
    const lh = Math.max(1, Math.min(limits, Math.round(quad.dh)))

    let layer = this.prepareLayer(quad, lw, lh)
    for (const pass of plan.passes) {
      layer = this.runEffectPass(layer, pass, lw, lh)
    }

    this.compositeFullFrame(layer, {
      identity: false,
      opacity: chrome.opacity,
      mode: BLEND_MODE_IDS[chrome.blendMode ?? 'normal'] ?? 0,
      inverse,
      halfW: quad.dw / 2,
      halfH: quad.dh / 2,
      cornerRadius: quad.cornerRadius,
    })
    this.releaseTexture(layer)
  }

  /** Sample (and crop) the source into a fresh layer texture. */
  private prepareLayer(quad: ImageQuad, lw: number, lh: number): GPUTexture {
    const layer = this.acquireTexture(lw, lh)
    const { width: iw, height: ih } = getImageSize(quad.image)
    const crop = quad.src
    const uniforms = new Float32Array(4)
    if (crop && iw > 0 && ih > 0) {
      uniforms.set([crop.sx / iw, crop.sy / ih, crop.sw / iw, crop.sh / ih])
    } else {
      uniforms.set([0, 0, 1, 1])
    }
    const uniformBuffer = this.uniformBuffer(uniforms.buffer as ArrayBuffer)

    const isExternal =
      (typeof VideoFrame !== 'undefined' && quad.image instanceof VideoFrame) ||
      (typeof HTMLVideoElement !== 'undefined' && quad.image instanceof HTMLVideoElement)

    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: layer.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } },
      ],
    })

    if (isExternal) {
      const external = this.device.importExternalTexture({
        source: quad.image as VideoFrame | HTMLVideoElement,
      })
      pass.setPipeline(this.pipelines.prepareExternal)
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.pipelines.prepareExternal.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: external },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: uniformBuffer } },
          ],
        }),
      )
    } else {
      // Bitmap-style sources upload through a staging texture.
      const sw = Math.max(1, iw)
      const sh = Math.max(1, ih)
      const staging = this.acquireTexture(sw, sh)
      this.device.queue.copyExternalImageToTexture(
        { source: quad.image as GPUCopyExternalImageSource },
        { texture: staging, premultipliedAlpha: true },
        { width: sw, height: sh },
      )
      pass.setPipeline(this.pipelines.prepare2d)
      pass.setBindGroup(
        0,
        this.device.createBindGroup({
          layout: this.pipelines.prepare2d.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: staging.createView() },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: uniformBuffer } },
          ],
        }),
      )
      this.releaseTexture(staging)
    }
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
    return layer
  }

  private runEffectPass(layer: GPUTexture, pass: EffectPass, lw: number, lh: number): GPUTexture {
    switch (pass.kind) {
      case 'color':
        return this.runColorPass(layer, pass, lw, lh)
      case 'blur':
        return this.runBlurPasses(layer, pass.radius, lw, lh)
      case 'shadow': {
        // Shadow = blur of the layer's alpha, offset + tinted, under the layer.
        const blurred = this.runBlurPasses(layer, pass.blur, lw, lh, true)
        const out = this.acquireTexture(lw, lh)
        const uniforms = new Float32Array(8)
        uniforms.set(pass.color, 0)
        uniforms.set([pass.offsetX / lw, pass.offsetY / lh], 4)
        this.renderFullscreen(this.pipelines.shadow, out, [
          { binding: 0, resource: layer.createView() },
          { binding: 1, resource: blurred.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: this.uniformBuffer(uniforms.buffer as ArrayBuffer) } },
        ])
        this.releaseTexture(blurred)
        this.releaseTexture(layer)
        return out
      }
      case 'lut3d': {
        const lut = this.luts.get(pass.lutId)
        if (!lut) return layer // unregistered: render ungraded
        const out = this.acquireTexture(lw, lh)
        const uniforms = new Float32Array(4)
        uniforms.set([lut.size, pass.intensity])
        this.renderFullscreen(this.pipelines.lut3d, out, [
          { binding: 0, resource: layer.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: lut.texture.createView() },
          { binding: 3, resource: { buffer: this.uniformBuffer(uniforms.buffer as ArrayBuffer) } },
        ])
        this.releaseTexture(layer)
        return out
      }
    }
  }

  private runColorPass(
    layer: GPUTexture,
    pass: Extract<EffectPass, { kind: 'color' }>,
    lw: number,
    lh: number,
  ): GPUTexture {
    if (pass.ops.length === 0) return layer
    const out = this.acquireTexture(lw, lh)

    // ColorUniforms: count vec4u + 16 × { kind vec4u, a vec4f, b vec4f }.
    const buffer = new ArrayBuffer(16 + 16 * 48)
    const u32 = new Uint32Array(buffer)
    const f32 = new Float32Array(buffer)
    u32[0] = Math.min(16, pass.ops.length)
    for (let i = 0; i < Math.min(16, pass.ops.length); i++) {
      const base = (16 + i * 48) / 4
      u32[base] = pass.ops[i]!.kind
      for (let p = 0; p < 8; p++) {
        f32[base + 4 + p] = pass.ops[i]!.params[p] ?? 0
      }
    }

    let curvesTexture = this.identityCurves
    if (pass.curves) {
      curvesTexture = this.acquireTexture(256, 1)
      const bytes = new Uint8Array(256 * 4)
      for (let i = 0; i < 256; i++) {
        bytes[i * 4] = Math.round(pass.curves.r[i]! * 255)
        bytes[i * 4 + 1] = Math.round(pass.curves.g[i]! * 255)
        bytes[i * 4 + 2] = Math.round(pass.curves.b[i]! * 255)
        bytes[i * 4 + 3] = 255
      }
      this.device.queue.writeTexture(
        { texture: curvesTexture },
        bytes,
        { bytesPerRow: 256 * 4 },
        { width: 256, height: 1 },
      )
    }

    this.renderFullscreen(this.pipelines.color, out, [
      { binding: 0, resource: layer.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: this.uniformBuffer(buffer) } },
      { binding: 3, resource: curvesTexture.createView() },
    ])
    if (curvesTexture !== this.identityCurves) this.releaseTexture(curvesTexture)
    this.releaseTexture(layer)
    return out
  }

  private runBlurPasses(
    layer: GPUTexture,
    radius: number,
    lw: number,
    lh: number,
    keepInput = false,
  ): GPUTexture {
    if (radius <= 0) return layer
    const weights = gaussianKernel(radius)
    const halfTaps = (weights.length - 1) / 2
    const weightsBuffer = this.storageBuffer(weights)

    const blurUniforms = (dx: number, dy: number): GPUBuffer => {
      const buffer = new ArrayBuffer(32)
      const f32 = new Float32Array(buffer)
      const u32 = new Uint32Array(buffer)
      f32[0] = dx
      f32[1] = dy
      f32[2] = 1 / lw
      f32[3] = 1 / lh
      u32[4] = halfTaps
      return this.uniformBuffer(buffer)
    }

    const horizontal = this.acquireTexture(lw, lh)
    this.renderFullscreen(this.pipelines.blur, horizontal, [
      { binding: 0, resource: layer.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: blurUniforms(1, 0) } },
      { binding: 3, resource: { buffer: weightsBuffer } },
    ])
    const vertical = this.acquireTexture(lw, lh)
    this.renderFullscreen(this.pipelines.blur, vertical, [
      { binding: 0, resource: horizontal.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: blurUniforms(0, 1) } },
      { binding: 3, resource: { buffer: weightsBuffer } },
    ])
    this.releaseTexture(horizontal)
    if (!keepInput) this.releaseTexture(layer)
    return vertical
  }

  private compositeFullFrame(
    layer: GPUTexture,
    options: {
      identity: boolean
      opacity: number
      mode: number
      inverse?: ReturnType<typeof invertChrome>
      halfW?: number
      halfH?: number
      cornerRadius?: number
    },
  ): void {
    const src = this.acc[this.accIndex]!
    const dst = this.acc[1 - this.accIndex]!

    const buffer = new ArrayBuffer(64)
    const f32 = new Float32Array(buffer)
    const u32 = new Uint32Array(buffer)
    const inv = options.inverse
    f32[0] = inv?.m00 ?? 1
    f32[1] = inv?.m01 ?? 0
    f32[2] = inv?.m10 ?? 0
    f32[3] = inv?.m11 ?? 1
    f32[4] = inv?.centerX ?? 0
    f32[5] = inv?.centerY ?? 0
    f32[6] = options.halfW ?? 0
    f32[7] = options.halfH ?? 0
    f32[8] = this.width
    f32[9] = this.height
    f32[10] = options.cornerRadius ?? 0
    f32[11] = options.opacity
    u32[12] = options.mode
    u32[13] = options.identity ? 1 : 0

    this.renderFullscreen(this.pipelines.composite, dst, [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: layer.createView() },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: { buffer: this.uniformBuffer(buffer) } },
    ])
    this.accIndex = 1 - this.accIndex
  }

  private renderFullscreen(
    pipeline: GPURenderPipeline,
    target: GPUTexture,
    entries: GPUBindGroupEntry[],
  ): void {
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }),
    )
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}
