import { z } from 'zod'
import type { Project } from './model'

export const propertyPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
})

export type PropertyPreset = z.infer<typeof propertyPresetSchema>

export function listPresets(project: Project, kind: string): PropertyPreset[] {
  return project.presets.filter((preset) => preset.kind === kind)
}
