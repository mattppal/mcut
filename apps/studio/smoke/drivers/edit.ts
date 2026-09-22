import type { Driver } from '../context.ts'

export const EDIT_DRIVERS = {
  move: null,
  delete: null,
  'text-title': null,
  'text-inline-edit': null,
  effects: null,
  transitions: null,
  keyframes: null,
  'animation-presets': null,
} satisfies Partial<Record<string, Driver | null>>
