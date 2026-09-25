'use client'

import { toast } from 'sonner'
import { createAsset } from '@mcut/media'
import type { EditorEngine } from '@mcut/timeline'
import type { AssetRef } from '@mcut/timeline'

export type OnAssetImported = (asset: AssetRef, file: File) => void

export const MEDIA_FILE_ACCEPT = 'video/*,audio/*,image/*,.mkv,.aac,.m4a,.opus,.flac'

export type MediaFileImport = { ok: true; asset: AssetRef } | { ok: false; name: string; error: string }

function importFailure(file: File, error: unknown): MediaFileImport {
  console.error(error)
  toast.error(`Could not import ${file.name}`)
  return { ok: false, name: file.name, error: error instanceof Error ? error.message : String(error) }
}

export async function importMediaFiles(engine: EditorEngine, files: File[], onAssetImported?: OnAssetImported): Promise<MediaFileImport[]> {
  const results: MediaFileImport[] = []
  for (const file of files) {
    try {
      const asset = await createAsset({ kind: 'blob', blob: file, name: file.name })
      engine.dispatch({ type: 'addAsset', asset }, { history: false })
      results.push({ ok: true, asset })
      onAssetImported?.(asset, file)
    } catch (error) {
      results.push(importFailure(file, error))
    }
  }
  return results
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}
