import { describe, expect, test } from 'bun:test'
import { pickDesktopRelease } from './update-feed'

describe('pickDesktopRelease', () => {
  test('a 0.x install follows the newest desktop prerelease and a 1.x install skips prereleases', () => {
    const releases = [
      { tag_name: '@mcut/timeline@0.2.0', prerelease: false, draft: false, body: 'timeline notes' },
      { tag_name: 'mcut-desktop@0.2.0', prerelease: true, draft: false, body: 'desktop notes' },
      { tag_name: 'mcut-desktop@0.1.0', prerelease: true, draft: false, body: null },
    ]
    expect(pickDesktopRelease(releases, '0.1.0')?.tag_name).toBe('mcut-desktop@0.2.0')
    expect(pickDesktopRelease(releases, '1.0.0')).toBeUndefined()
  })
})
