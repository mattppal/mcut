import { z } from 'zod'

const RELEASES_API = 'https://api.github.com/repos/mattppal/mcut/releases?per_page=100'
const DOWNLOAD_BASE = 'https://github.com/mattppal/mcut/releases/download/'
const DESKTOP_TAG_PREFIX = 'mcut-desktop@'
const NOTES_LIMIT = 1200

const releaseSchema = z.object({ tag_name: z.string(), prerelease: z.boolean(), draft: z.boolean(), body: z.string().nullable() })

const releasesSchema = z.array(releaseSchema)

type DesktopRelease = z.infer<typeof releaseSchema>

export interface UpdateFeed {
  url: string
  notes: string | null
}

function allowsPrerelease(currentVersion: string): boolean {
  return currentVersion.startsWith('0.') || currentVersion.includes('-')
}

export function pickDesktopRelease(releases: readonly DesktopRelease[], currentVersion: string): DesktopRelease | undefined {
  const prereleases = allowsPrerelease(currentVersion)
  return releases.find((release) => release.tag_name.startsWith(DESKTOP_TAG_PREFIX) && !release.draft && (prereleases || !release.prerelease))
}

function releaseNotes(body: string | null): string | null {
  const trimmed = body?.trim() ?? ''
  return trimmed.length === 0 ? null : trimmed.slice(0, NOTES_LIMIT)
}

export async function resolveDesktopRelease(currentVersion: string): Promise<UpdateFeed | undefined> {
  const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mcut-studio' } })
  if (!response.ok) throw new Error(`GitHub releases responded ${response.status} ${response.statusText}.`)
  const body: unknown = await response.json()
  const release = pickDesktopRelease(releasesSchema.parse(body), currentVersion)
  if (release === undefined) return undefined
  return { url: `${DOWNLOAD_BASE}${release.tag_name}/`, notes: releaseNotes(release.body) }
}
