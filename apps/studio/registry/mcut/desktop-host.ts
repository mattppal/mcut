'use client'

import { toast } from 'sonner'
import { readDesktopApi, type DesktopErrorShape, type MenuAction } from '@mcut/desktop-ipc'
import { loadMediaBlob } from '@mcut/media'
import type { Project } from '@mcut/timeline'
import type { StudioHost } from './studio-host'

declare global {
  interface WindowEventMap {
    'mcut:run-action': CustomEvent<string>
  }
}

const MENU_ACTION_IDS: Record<MenuAction, string> = {
  'project.open': 'file.open',
  'project.save': 'file.save',
  'project.saveAs': 'file.save-as',
}

function reportFailure(error: DesktopErrorShape): void {
  if (error.code !== 'cancelled') toast.error(error.message)
}

async function relinkAssets(project: Project): Promise<{ project: Project; missing: number }> {
  let missing = 0
  const assets = { ...project.assets }
  for (const [id, asset] of Object.entries(assets)) {
    const blob = asset.hash ? await loadMediaBlob(asset.hash).catch(() => null) : null
    if (blob) {
      assets[id] = { ...asset, src: URL.createObjectURL(blob) }
      continue
    }
    if (asset.src.startsWith('blob:')) missing += 1
  }
  return { project: { ...project, assets }, missing }
}

export function createDesktopHost(): StudioHost | null {
  const api = readDesktopApi()
  if (api === null) return null
  const filePaths = new Map<string, string>()

  api.onMenu((action) => {
    window.dispatchEvent(new CustomEvent('mcut:run-action', { detail: MENU_ACTION_IDS[action] }))
  })

  const save = async (project: Project, path: string | null): Promise<void> => {
    const saved = await api.projects.save({ project, path })
    if (!saved.ok) return reportFailure(saved.error)
    filePaths.set(project.id, saved.value.path)
    toast.success(`Saved ${saved.value.path}`)
  }

  return {
    openProject: async (engine) => {
      const opened = await api.projects.open()
      if (!opened.ok) return reportFailure(opened.error)
      const { project, missing } = await relinkAssets(opened.value.project)
      engine.loadProject(project)
      filePaths.set(project.id, opened.value.path)
      if (missing > 0) {
        toast.warning(`${missing} media file(s) are not on this device. Re-import them to relink.`)
      } else {
        toast.success(`Opened ${project.name}`)
      }
    },
    saveProject: (project) => save(project, filePaths.get(project.id) ?? null),
    saveProjectAs: (project) => save(project, null),
    transcriptionSettings: {
      isConfigured: async () => {
        const info = await api.info()
        return info.ok && info.value.transcription.configured
      },
      setKey: async (key) => {
        const result = await api.setTranscriptionKey(key)
        if (!result.ok) {
          reportFailure(result.error)
          return false
        }
        return result.value.configured
      },
    },
  }
}
