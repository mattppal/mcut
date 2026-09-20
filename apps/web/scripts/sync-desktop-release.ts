import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ASSET_TARGETS, type DesktopRelease, type ReleaseAsset } from '../lib/desktop-release'

const TAG_PREFIX = 'mcut-desktop@'
const RELEASES_URL = 'https://api.github.com/repos/mattppal/mcut/releases?per_page=30'
const appRoot = process.cwd()
const generatedPath = path.join(appRoot, 'lib/desktop-release.generated.ts')

type DraftAsset = { name: string; url: string; bytes: number }

type DraftRelease = {
  tag: string
  publishedAt: string
  notesUrl: string
  assets: DraftAsset[]
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readField(value: object, key: string): unknown {
  if (!(key in value)) return undefined
  return Reflect.get(value, key)
}

function readString(value: object, key: string): string | null {
  const field = readField(value, key)
  if (typeof field !== 'string' || field.length === 0) return null
  return field
}

function readAsset(value: unknown): DraftAsset | null {
  if (!isObject(value)) return null
  const name = readString(value, 'name')
  const url = readString(value, 'browser_download_url')
  const bytes = readField(value, 'size')
  if (name === null || url === null || typeof bytes !== 'number' || !Number.isFinite(bytes)) return null
  return { name, url, bytes }
}

function readRelease(value: unknown): DraftRelease | null {
  if (!isObject(value)) return null
  if (readField(value, 'draft') !== false) return null
  const tag = readString(value, 'tag_name')
  const publishedAt = readString(value, 'published_at')
  const notesUrl = readString(value, 'html_url')
  if (tag === null || publishedAt === null || notesUrl === null) return null
  if (!tag.startsWith(TAG_PREFIX) || tag.length === TAG_PREFIX.length) return null
  if (Number.isNaN(Date.parse(publishedAt))) return null
  const rawAssets = readField(value, 'assets')
  if (!Array.isArray(rawAssets)) return null
  const assets: DraftAsset[] = []
  for (const item of rawAssets) {
    const asset = readAsset(item)
    if (asset !== null) assets.push(asset)
  }
  return { tag, publishedAt, notesUrl, assets }
}

function assetForSuffix(assets: readonly DraftAsset[], suffix: string): ReleaseAsset | null {
  const hits = assets.filter((asset) => asset.name.endsWith(suffix))
  if (hits.length !== 1) return null
  const hit = hits[0]
  if (hit === undefined) return null
  return { name: hit.name, url: hit.url, bytes: hit.bytes }
}

function collectAssets(assets: readonly DraftAsset[]): DesktopRelease['assets'] | null {
  const macArm64 = assetForSuffix(assets, ASSET_TARGETS['mac-arm64'].suffix)
  const macX64 = assetForSuffix(assets, ASSET_TARGETS['mac-x64'].suffix)
  const linux = assetForSuffix(assets, ASSET_TARGETS['linux-x86_64'].suffix)
  if (macArm64 === null || macX64 === null || linux === null) return null
  return { 'mac-arm64': macArm64, 'mac-x64': macX64, 'linux-x86_64': linux }
}

function toDesktopRelease(release: DraftRelease): DesktopRelease | null {
  const assets = collectAssets(release.assets)
  if (assets === null) return null
  return {
    version: release.tag.slice(TAG_PREFIX.length),
    tag: release.tag,
    publishedAt: release.publishedAt,
    notesUrl: release.notesUrl,
    assets,
  }
}

function emit(release: DesktopRelease | null): string {
  const body = release === null ? 'null' : JSON.stringify(release, null, 2)
  return `import type { DesktopRelease } from './desktop-release'\n\nexport const desktopRelease: DesktopRelease | null = ${body}\n`
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function fetchReleaseList(): Promise<unknown> {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mcut-web',
  })
  const token = process.env.GITHUB_TOKEN
  if (typeof token === 'string' && token.length > 0) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(RELEASES_URL, { headers })
  if (!response.ok) throw new Error(`GitHub responded ${response.status}`)
  return response.json()
}

function pickRelease(body: unknown): DesktopRelease | null {
  if (!Array.isArray(body)) return null
  const releases: DraftRelease[] = []
  for (const item of body) {
    const release = readRelease(item)
    if (release !== null) releases.push(release)
  }
  releases.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
  for (const release of releases) {
    const desktop = toDesktopRelease(release)
    if (desktop !== null) return desktop
  }
  return null
}

const hadFile = await fileExists(generatedPath)
if (!hadFile) await writeFile(generatedPath, emit(null))

try {
  const body = await fetchReleaseList()
  const release = pickRelease(body)
  if (release === null) {
    console.error('sync-desktop-release: no mcut-desktop release with all three assets')
  } else {
    await writeFile(generatedPath, emit(release))
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : 'request failed'
  console.error(`sync-desktop-release: ${reason}`)
}
