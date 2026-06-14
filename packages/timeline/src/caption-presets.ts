import type { CaptionStyle } from './model'

/**
 * Named caption looks (the Twick/CapCut pattern: presets are data, not
 * code) — style patches merged over each caption's current style. Karaoke
 * variants drive the per-word `activeWordColor` highlight the renderer
 * already supports; word timings come from transcription.
 */
export interface CaptionStylePreset {
  id: string
  label: string
  style: Partial<CaptionStyle>
}

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    style: {
      fontWeight: 700,
      fontSize: 48,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      position: 'bottom',
    },
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    style: {
      fontWeight: 800,
      fontSize: 52,
      color: 'rgba(255, 255, 255, 0.75)',
      activeWordColor: '#facc15',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      position: 'bottom',
    },
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    style: {
      fontWeight: 800,
      fontSize: 56,
      color: 'rgba(255, 255, 255, 0.45)',
      activeWordColor: '#ffffff',
      backgroundColor: 'transparent',
      position: 'middle',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    style: {
      fontWeight: 600,
      fontSize: 40,
      color: '#ffffff',
      backgroundColor: 'transparent',
      position: 'bottom',
    },
  },
  {
    id: 'bold',
    label: 'Bold',
    style: {
      fontWeight: 900,
      fontSize: 72,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      position: 'bottom',
    },
  },
  {
    id: 'banner',
    label: 'Banner',
    style: {
      fontWeight: 700,
      fontSize: 44,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      position: 'top',
    },
  },
]
