'use client'

import { toast } from 'sonner'
import type { ImportMediaBridgeFile, MediaImportReport } from '@mcut/mcp-server/contract'
import type { AssetRef, EditorEngine } from '@mcut/timeline'
import { importMediaFiles } from './media-import'
import { saveAssetBlob } from './persistence'

function importedRow(path: string, asset: AssetRef): MediaImportReport['imported'][number] {
  return {
    path,
    assetId: asset.id,
    name: asset.name ?? path,
    kind: asset.kind,
    ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function importGrantedMedia(engine: EditorEngine, files: readonly ImportMediaBridgeFile[]): Promise<MediaImportReport> {
  const ready: { path: string; file: File }[] = []
  const failed: MediaImportReport['failed'] = []
  for (const entry of files) {
    try {
      const response = await fetch(entry.url)
      if (!response.ok) throw new Error(`import_media could not fetch ${entry.name} (${response.status}).`)
      const blob = await response.blob()
      ready.push({ path: entry.path, file: new File([blob], entry.name, { type: entry.mimeType }) })
    } catch (error) {
      failed.push({ path: entry.path, error: failureMessage(error) })
    }
  }
  const results = await importMediaFiles(
    engine,
    ready.map((item) => item.file),
    (asset, file) => {
      void saveAssetBlob(asset, file)
    },
  )
  const imported: MediaImportReport['imported'] = []
  for (let index = 0; index < ready.length; index += 1) {
    const item = ready[index]
    const result = results[index]
    if (item === undefined || result === undefined) continue
    if (result.ok) imported.push(importedRow(item.path, result.asset))
    else failed.push({ path: item.path, error: result.error })
  }
  if (imported.length > 0) toast.success(`Imported ${imported.length} file${imported.length > 1 ? 's' : ''}`)
  return { imported, failed }
}
