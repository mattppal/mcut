'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { PreviewMediaPool } from '@mcut/media'
import { EditorEngine, type Project } from '@mcut/timeline'

export interface EditorContextValue {
  engine: EditorEngine
  pool: PreviewMediaPool
}

const EditorContext = createContext<EditorContextValue | null>(null)

export interface EditorProviderProps {
  /** Bring your own engine (e.g. created outside React); otherwise one is created. */
  engine?: EditorEngine
  /** Initial project for the internally-created engine. */
  project?: Project
  maxHistorySize?: number
  children: ReactNode
}

/**
 * Provides the editor engine and the preview media pool to the component
 * tree. All mcut UI (PlayerCanvas, timeline panels, ...) lives under this.
 */
export function EditorProvider({
  engine: externalEngine,
  project,
  maxHistorySize,
  children,
}: EditorProviderProps) {
  const [value] = useState<EditorContextValue>(() => {
    const engine =
      externalEngine ??
      new EditorEngine({
        ...(project ? { project } : {}),
        ...(maxHistorySize !== undefined ? { maxHistorySize } : {}),
      })
    const pool = new PreviewMediaPool((assetId) => engine.project.assets[assetId])
    return { engine, pool }
  })

  useEffect(() => () => value.pool.dispose(), [value])

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext)
  if (!context) {
    throw new Error('mcut hooks must be used inside <EditorProvider>')
  }
  return context
}
