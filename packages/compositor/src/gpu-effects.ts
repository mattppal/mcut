import { registerEffectType } from '@mcut/timeline'
import { z } from 'zod'

/**
 * GPU-only effects — they exist only on the WebGPU backend (the canvas2d
 * reference path has no per-pixel programmability, so `toFilter` is inert
 * and the layer renders without them there). Registered through the same
 * registry the CSS-filter built-ins use, so they parse in saved projects,
 * validate, and get inspector UI for free.
 */

const curvePointSchema = z.object({
  /** Input level 0..1. */
  x: z.number().min(0).max(1),
  /** Output level 0..1. */
  y: z.number().min(0).max(1),
})

let registered = false

/** Idempotent; the compositor registers these at module load. */
export function registerGpuEffectTypes(): void {
  if (registered) return
  registered = true

  registerEffectType({
    type: 'chroma-key',
    shape: {
      /** Key color to remove (green-screen green by default). */
      keyColor: z.string().default('#00ff00'),
      /** Chroma distance (YCbCr plane) treated as fully transparent. */
      tolerance: z.number().min(0).max(1).default(0.25),
      /** Distance band over which alpha ramps back in. */
      softness: z.number().min(0).max(1).default(0.1),
      /** How strongly key-colored spill is pulled out of kept pixels. */
      spillSuppression: z.number().min(0).max(1).default(0.5),
    },
    toFilter: () => '', // WebGPU-only
    param: { key: 'tolerance', min: 0, max: 1 },
  })

  registerEffectType({
    type: 'curves',
    shape: {
      /** Master curve, applied after the per-channel ones. */
      rgb: z.array(curvePointSchema).optional(),
      red: z.array(curvePointSchema).optional(),
      green: z.array(curvePointSchema).optional(),
      blue: z.array(curvePointSchema).optional(),
    },
    toFilter: () => '', // WebGPU-only
  })

  registerEffectType({
    type: 'lut3d',
    shape: {
      /**
       * Identifier of a LUT registered with the WebGPU backend at runtime
       * (`WebGPUBackend.registerLut3D`) — LUT pixel data doesn't belong in
       * project JSON.
       */
      lutId: z.string().min(1),
      /** Blend between original (0) and graded (1). */
      intensity: z.number().min(0).max(1).default(1),
    },
    toFilter: () => '', // WebGPU-only
  })
}

registerGpuEffectTypes()
