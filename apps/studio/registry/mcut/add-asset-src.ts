import { CommandError } from '@mcut/timeline'
import { probeImage, probeMedia } from '@mcut/media'
import { z } from 'zod'

const assetKindSchema = z.enum(['video', 'audio', 'image'])

const assetFieldsSchema = z.looseObject({
  id: z.string().optional(),
  kind: assetKindSchema.optional(),
  src: z.string(),
  hash: z.string().optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  nativePreview: z.boolean().optional(),
  durationMs: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
})

const addAssetCommandSchema = z.looseObject({
  type: z.string(),
  asset: assetFieldsSchema,
})

type AssetFields = z.infer<typeof assetFieldsSchema>
type AssetKind = z.infer<typeof assetKindSchema>

interface ProbedAsset {
  kind: AssetKind
  durationMs?: number
  width?: number
  height?: number
  mimeType?: string
}

function isFileUrl(src: string): boolean {
  return src.trim().toLowerCase().startsWith('file:')
}

function kindFromExtension(src: string): AssetKind | undefined {
  const pathname = (() => {
    try {
      return new URL(src).pathname
    } catch {
      return src
    }
  })()
  const ext = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'image'
    case 'mp3':
    case 'm4a':
    case 'aac':
    case 'wav':
    case 'flac':
    case 'ogg':
    case 'opus':
      return 'audio'
    case 'mp4':
    case 'mov':
    case 'm4v':
    case 'webm':
    case 'mkv':
      return 'video'
    default:
      return undefined
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function probeAssetSource(src: string, kind: AssetKind | undefined): Promise<ProbedAsset> {
  const resolved = kind ?? kindFromExtension(src) ?? 'video'
  try {
    if (resolved === 'image') {
      const image = await probeImage(src)
      return { kind: 'image', width: image.width, height: image.height }
    }
    const probe = await probeMedia(src)
    if (!probe.hasVideo && !probe.hasAudio) throw new Error('no playable audio or video tracks')
    if (probe.durationMs <= 0) throw new Error('no playable media (duration 0 ms)')
    return {
      kind: kind ?? (probe.hasVideo ? 'video' : 'audio'),
      durationMs: probe.durationMs,
      ...(probe.width !== undefined ? { width: probe.width } : {}),
      ...(probe.height !== undefined ? { height: probe.height } : {}),
      ...(probe.mimeType !== undefined ? { mimeType: probe.mimeType } : {}),
    }
  } catch (error) {
    throw new CommandError('asset-unloadable', `addAsset could not load ${src}. ${reason(error)}`, { cause: error })
  }
}

function fillAsset(asset: AssetFields, probe: ProbedAsset): AssetFields {
  const kind = asset.kind ?? probe.kind
  const durationMs = asset.durationMs ?? probe.durationMs
  const width = asset.width ?? probe.width
  const height = asset.height ?? probe.height
  const mimeType = asset.mimeType !== undefined && asset.mimeType.length > 0 ? asset.mimeType : probe.mimeType
  return {
    src: asset.src,
    ...(asset.id !== undefined ? { id: asset.id } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(asset.hash !== undefined ? { hash: asset.hash } : {}),
    ...(asset.name !== undefined ? { name: asset.name } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(asset.nativePreview !== undefined ? { nativePreview: asset.nativePreview } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  }
}

export async function prepareAddAssetCommand(command: unknown): Promise<unknown> {
  const parsed = addAssetCommandSchema.safeParse(command)
  if (!parsed.success || parsed.data.type !== 'addAsset') return command
  const src = parsed.data.asset.src
  if (isFileUrl(src)) {
    throw new CommandError('asset-unloadable', `addAsset cannot load ${src}. Studio cannot read file URLs. Import local files with import_media { paths }.`)
  }
  const probe = await probeAssetSource(src, parsed.data.asset.kind)
  return { ...parsed.data, asset: fillAsset(parsed.data.asset, probe) }
}
