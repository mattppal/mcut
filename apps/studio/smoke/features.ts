export const SURFACES = ['embed', 'electron-dev', 'installed'] as const
export type Surface = (typeof SURFACES)[number]

export const TIERS = ['fast', 'full'] as const
export type Tier = (typeof TIERS)[number]

export const FEATURES = [
  'open-editor',
  'import-media',
  'add-to-timeline',
  'playback',
  'seek',
  'trim',
  'split',
  'move',
  'delete',
  'undo-redo',
  'text-title',
  'text-inline-edit',
  'effects',
  'transitions',
  'keyframes',
  'animation-presets',
  'captions-on-device',
  'captions-on-device-cached',
  'captions-assemblyai',
  'captions-export',
  'transcript-panel',
  'multicam',
  'collage',
  'aspect-presets',
  'export-webm',
  'export-mp4',
  'export-mkv',
  'save-project',
  'open-project',
  'main-menu',
  'command-palette',
  'shortcuts-dialog',
  'settings-theme',
  'settings-snapping',
  'mcp-bridge',
] as const
export type FeatureId = (typeof FEATURES)[number]

export type Availability = { kind: 'drive' } | { kind: 'unsupported'; reason: string }

export interface Feature {
  id: FeatureId
  label: string
  tier: Tier
  surfaces: Record<Surface, Availability>
}

const drive: Availability = { kind: 'drive' }
const everywhere: Record<Surface, Availability> = { embed: drive, 'electron-dev': drive, installed: drive }
const desktopOnly = (reason: string): Record<Surface, Availability> => ({
  embed: { kind: 'unsupported', reason },
  'electron-dev': drive,
  installed: drive,
})

const feature = (id: FeatureId, label: string, tier: Tier, surfaces: Record<Surface, Availability> = everywhere): Feature => ({ id, label, tier, surfaces })

export const FEATURE_TABLE: readonly Feature[] = [
  feature('open-editor', 'Open the editor on an empty project', 'fast'),
  feature('import-media', 'Import a clip into the media bin', 'fast'),
  feature('add-to-timeline', 'Place the clip on Track 1', 'fast'),
  feature('playback', 'Play and pause with Space', 'fast'),
  feature('seek', 'Scrub the ruler and nudge by one second', 'full'),
  feature('trim', 'Drag the clip edge to shorten it', 'fast'),
  feature('split', 'Split the clip at the playhead', 'fast'),
  feature('move', 'Drag the clip along the lane', 'full'),
  feature('delete', 'Delete the selected clip', 'full'),
  feature('undo-redo', 'Undo and redo the last edit', 'fast'),
  feature('text-title', 'Add a Title from the Text tab', 'fast'),
  feature('text-inline-edit', 'Edit the title text on the canvas', 'full'),
  feature('effects', 'Change an effect field in the inspector', 'full'),
  feature('transitions', 'Add a transition between two clips', 'full'),
  feature('keyframes', 'Add a keyframe to a transform property', 'full'),
  feature('animation-presets', 'Apply an animation preset', 'full'),
  feature('captions-on-device', 'Auto-caption with Whisper on this device, including the first-run model download', 'full'),
  feature('captions-on-device-cached', 'Auto-caption again from the cached model with no upstream request', 'full'),
  feature(
    'captions-assemblyai',
    'Save an AssemblyAI key and caption through the cloud provider',
    'full',
    desktopOnly('The AssemblyAI key lives in the desktop main process behind safeStorage. The site has no secret store, so the captions panel has no key field.'),
  ),
  feature('captions-export', 'Download the captions as SRT and VTT', 'full'),
  feature('transcript-panel', 'Open the Transcript tab', 'full'),
  feature('multicam', 'Build a multicam clip from two sources', 'full'),
  feature('collage', 'Build a collage from two sources', 'full'),
  feature('aspect-presets', 'Switch the project aspect to 9:16', 'full'),
  feature('export-webm', 'Export the timeline as WebM', 'fast'),
  feature('export-mp4', 'Export the timeline as MP4', 'full'),
  feature('export-mkv', 'Export the timeline as MKV', 'full'),
  feature('save-project', 'Save the project file', 'full'),
  feature('open-project', 'Open the saved project file', 'full'),
  feature('main-menu', 'Open the main menu and its File submenu', 'fast'),
  feature('command-palette', 'Open the command palette and run a command', 'full'),
  feature('shortcuts-dialog', 'Open the keyboard shortcuts dialog', 'full'),
  feature('settings-theme', 'Toggle the theme', 'full'),
  feature('settings-snapping', 'Toggle snapping from the View menu', 'full'),
  feature('mcp-bridge', 'The live MCP bridge reports the editor connected', 'full', desktopOnly('The live bridge is a 127.0.0.1 server in the desktop main process, which the site has no equivalent of.')),
]

export function featuresForTier(tier: Tier): readonly Feature[] {
  return tier === 'full' ? FEATURE_TABLE : FEATURE_TABLE.filter((entry) => entry.tier === 'fast')
}
