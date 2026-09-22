import type { Driver } from '../context.ts'

export const MODE_DRIVERS = {
  multicam: null,
  collage: null,
  'aspect-presets': null,
} satisfies Partial<Record<string, Driver | null>>
