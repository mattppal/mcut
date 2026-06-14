import { z } from 'zod'
import type { Project } from './model'

/**
 * Property presets: named bundles of inspector values, the ONE preset
 * primitive every editing surface shares (Figma styles, loosely). A preset
 * is pure data — `kind` names the surface that captured it ("effects",
 * "text-style", "slot-style", …) and `values` holds whatever that surface
 * chose to capture. Applying is the surface's job: it reads `values` and
 * writes them back through its normal commands, so presets work identically
 * for timeline elements and multicam layout slots without bespoke plumbing.
 *
 * Presets referenced by a project live IN the project (`project.presets`)
 * so documents stay self-contained, mirroring `project.layouts`.
 */
export const propertyPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Which inspector surface this preset belongs to (free-form key). */
  kind: z.string().min(1),
  /** The captured values; opaque to the engine, owned by the surface. */
  values: z.record(z.string(), z.unknown()),
})

export type PropertyPreset = z.infer<typeof propertyPresetSchema>

/** The project's presets for one surface, in saved order. */
export function listPresets(project: Project, kind: string): PropertyPreset[] {
  return project.presets.filter((preset) => preset.kind === kind)
}
