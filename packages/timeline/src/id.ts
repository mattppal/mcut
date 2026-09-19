export type TrackId = `t-${string}`
export type ElementId = `e-${string}`
export type AssetId = `a-${string}`
export type MarkerId = `m-${string}`
export type GroupId = `g-${string}`

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export const createTrackId = (): TrackId => `t-${randomSuffix()}`
export const createElementId = (): ElementId => `e-${randomSuffix()}`
export const createAssetId = (): AssetId => `a-${randomSuffix()}`
export const createMarkerId = (): MarkerId => `m-${randomSuffix()}`
export const createProjectId = (): string => `p-${randomSuffix()}`
export const createLinkId = (): string => `l-${randomSuffix()}`
export const createGroupId = (): GroupId => `g-${randomSuffix()}`
export const createLayoutId = (): string => `lay-${randomSuffix()}`
export const createPresetId = (): string => `ps-${randomSuffix()}`
