'use client'

import { toast } from 'sonner'
import { createAsset } from '@mcut/media'
import type { EditorEngine } from '@mcut/timeline'
import type { AssetRef } from '@mcut/timeline'

export type OnAssetImported = (asset: AssetRef, file: File) => void

export async function importMediaFiles(engine: EditorEngine, files: File[], onAssetImported?: OnAssetImported): Promise<AssetRef[]> {
  const imported: AssetRef[] = []
  for (const file of files) {
    try {
      const asset = await createAsset({ kind: 'blob', blob: file, name: file.name })
      engine.dispatch({ type: 'addAsset', asset }, { history: false })
      imported.push(asset)
      onAssetImported?.(asset, file)
    } catch (error) {
      console.error(error)
      toast.error(`Could not import ${file.name}`)
    }
  }
  return imported
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
