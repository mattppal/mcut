import { desktopRelease } from './desktop-release.generated'
import type { DesktopRelease } from './desktop-release'

export const STUDIO_RELEASED = false

export function publicRelease(): DesktopRelease | null {
  return STUDIO_RELEASED ? desktopRelease : null
}
