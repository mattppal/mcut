export type TrackId = `t-${string}`
export type ElementId = `e-${string}`
export type AssetId = `a-${string}`
export type MarkerId = `m-${string}`

function randomSuffix(): string {
  // crypto.randomUUID is available in all supported runtimes (browser, Bun, Node 19+).
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export const createTrackId = (): TrackId => `t-${randomSuffix()}`
export const createElementId = (): ElementId => `e-${randomSuffix()}`
export const createAssetId = (): AssetId => `a-${randomSuffix()}`
export const createMarkerId = (): MarkerId => `m-${randomSuffix()}`
export const createProjectId = (): string => `p-${randomSuffix()}`
/** Shared by linked elements (e.g. a video and its detached audio). */
export const createLinkId = (): string => `l-${randomSuffix()}`
/** Multicam layout templates (project-level and library). */
export const createLayoutId = (): string => `lay-${randomSuffix()}`
/** Property presets (named inspector value bundles; see presets.ts). */
export const createPresetId = (): string => `ps-${randomSuffix()}`
