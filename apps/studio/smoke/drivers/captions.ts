import type { Driver } from '../context.ts'

export const CAPTION_DRIVERS = {
  'captions-on-device': null,
  'captions-on-device-cached': null,
  'captions-assemblyai': null,
  'captions-export': null,
  'transcript-panel': null,
} satisfies Partial<Record<string, Driver | null>>
