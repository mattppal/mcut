'use client'

import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { ASSET_KEYS, ASSET_TARGETS, type AssetKey, type DesktopRelease } from '@/lib/desktop-release'
import { detectAssetKey, type PlatformMatch } from '@/lib/detect-platform'
import { cn } from '@/lib/utils'

let detected: PlatformMatch | null | undefined

function clientMatch(): PlatformMatch | null {
  if (detected !== undefined) return detected
  detected = detectAssetKey()
  return detected
}

function serverMatch(): null {
  return null
}

function subscribe(): () => void {
  return () => {}
}

function badgeText(match: PlatformMatch | null, key: AssetKey): string | null {
  if (match === null || match.key !== key) return null
  if (match.certain) return 'Recommended for this device'
  return 'Recommended, pick Intel below if this Mac has an Intel chip'
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export function DownloadList({ release }: { release: DesktopRelease }) {
  const match = useSyncExternalStore(subscribe, clientMatch, serverMatch)

  return (
    <ul className="flex flex-col gap-3">
      {ASSET_KEYS.map((key) => {
        const target = ASSET_TARGETS[key]
        const asset = release.assets[key]
        const badge = badgeText(match, key)
        const recommended = badge !== null
        return (
          <li
            key={key}
            className={cn(
              'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
              recommended ? 'border-foreground/40' : 'border-border',
            )}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{target.label}</span>
                {badge !== null ? <span className="text-xs text-muted-foreground">{badge}</span> : null}
              </div>
              <span className="text-xs text-muted-foreground">{target.hint}</span>
              <span className="truncate font-mono text-xs">{asset.name}</span>
              <span className="text-xs text-muted-foreground">{formatMegabytes(asset.bytes)}</span>
            </div>
            <Button variant={recommended ? 'default' : 'outline'} nativeButton={false} render={<a href={asset.url} download />}>
              Download
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
