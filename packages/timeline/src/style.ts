import { z } from 'zod'

/**
 * The shared appearance primitives — ONE schema per concept, reused by every
 * surface that can carry it (Figma's property model: capabilities attach to
 * anything with a frame, not to specific node types):
 *
 *  - `stroke`  → text glyphs, media frames (video/image), layout slots
 *  - `shadow`  → text glyphs, media frames
 *  - `crop`    → media frames
 *
 * Keeping these single-sourced is what lets the preset system ("style"
 * kind) move a look between a multicam slot, a plain clip, and a title:
 * the values mean the same thing everywhere.
 */

/** Outline drawn on the owner's silhouette (glyph edges or frame rect). */
export const strokeSchema = z.object({
  /** Any CSS color. */
  color: z.string().default('#000000'),
  /** Visible width in project px (frames paint it inside the bounds). */
  width: z.number().positive(),
})

/** Soft drop shadow behind the owner. */
export const shadowSchema = z.object({
  /** Any CSS color (alpha encodes the strength). */
  color: z.string().default('rgba(0, 0, 0, 0.6)'),
  blur: z.number().nonnegative().default(12),
  offsetX: z.number().default(0),
  offsetY: z.number().default(6),
})

/**
 * Source-space crop mask, normalized 0..1 of the media's natural size. The
 * kept region BECOMES the element's frame: natural size shrinks to
 * `w × h` of the asset, so layout, handles, and the inspector all follow.
 */
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().positive().max(1),
    h: z.number().positive().max(1),
  })
  .refine((c) => c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001, 'crop must stay inside the source')

export type Stroke = z.infer<typeof strokeSchema>
export type Shadow = z.infer<typeof shadowSchema>
export type Crop = z.infer<typeof cropSchema>

/** A reasonable starting shadow (the text inspector's long-time default). */
export const DEFAULT_SHADOW: Shadow = { color: 'rgba(0, 0, 0, 0.6)', blur: 12, offsetX: 0, offsetY: 6 }
