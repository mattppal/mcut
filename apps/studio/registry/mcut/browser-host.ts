'use client'

import { openProjectFromFile, saveProjectToFile } from './project-file'
import type { StudioHost } from './studio-host'

export const browserHost: StudioHost = {
  openProject: (engine) => openProjectFromFile(engine),
  saveProject: async (project) => saveProjectToFile(project),
  saveProjectAs: async (project) => saveProjectToFile(project),
  transcriptionSettings: null,
  windowChrome: 'browser',
  updates: null,
}
