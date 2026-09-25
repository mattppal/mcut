import type { Driver } from '../context.ts'
import type { FeatureId } from '../features.ts'
import { CAPTION_DRIVERS } from './captions.ts'
import { CORE_DRIVERS } from './core.ts'
import { EDIT_DRIVERS } from './edit.ts'
import { MODE_DRIVERS } from './modes.ts'
import { PROJECT_DRIVERS } from './project.ts'
import { REFRAME_DRIVERS } from './reframe.ts'

export const DRIVERS: Record<FeatureId, Driver | null> = {
  ...CORE_DRIVERS,
  ...EDIT_DRIVERS,
  ...CAPTION_DRIVERS,
  ...MODE_DRIVERS,
  ...REFRAME_DRIVERS,
  ...PROJECT_DRIVERS,
}
