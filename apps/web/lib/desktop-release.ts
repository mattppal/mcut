export type AssetKey = 'mac-arm64' | 'mac-x64' | 'linux-x86_64'

export type ReleaseAsset = { name: string; url: string; bytes: number }

export type DesktopRelease = {
  version: string
  tag: string
  publishedAt: string
  notesUrl: string
  assets: Record<AssetKey, ReleaseAsset>
}

export const ASSET_TARGETS: Record<AssetKey, { suffix: string; os: 'macOS' | 'Linux'; label: string; hint: string }> = {
  'mac-arm64': { suffix: '-mac-arm64.dmg', os: 'macOS', label: 'macOS, Apple silicon', hint: 'M1 and later' },
  'mac-x64': { suffix: '-mac-x64.dmg', os: 'macOS', label: 'macOS, Intel', hint: 'Intel Macs' },
  'linux-x86_64': { suffix: '-linux-x86_64.AppImage', os: 'Linux', label: 'Linux, x86_64', hint: 'AppImage' },
}

export const ASSET_KEYS: AssetKey[] = ['mac-arm64', 'mac-x64', 'linux-x86_64']
