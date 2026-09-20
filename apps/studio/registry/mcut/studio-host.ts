import type { EditorEngine, Project } from '@mcut/timeline'
import { browserHost } from './browser-host'
import { createDesktopHost } from './desktop-host'

export interface TranscriptionSettings {
  isConfigured(): Promise<boolean>
  setKey(key: string): Promise<boolean>
}

export type WindowChrome = 'browser' | 'mac' | 'linux'

export interface StudioHost {
  openProject(engine: EditorEngine): Promise<void>
  saveProject(project: Project): Promise<void>
  saveProjectAs(project: Project): Promise<void>
  transcriptionSettings: TranscriptionSettings | null
  windowChrome: WindowChrome
}

export const host: StudioHost = createDesktopHost() ?? browserHost
