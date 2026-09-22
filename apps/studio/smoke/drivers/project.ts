import type { Driver } from '../context.ts'

export const PROJECT_DRIVERS = {
  'save-project': null,
  'open-project': null,
  'command-palette': null,
  'shortcuts-dialog': null,
  'settings-theme': null,
  'settings-snapping': null,
} satisfies Partial<Record<string, Driver | null>>
