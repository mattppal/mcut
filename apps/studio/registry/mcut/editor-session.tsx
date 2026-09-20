'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GroupProps } from 'react-resizable-panels'
import { toast } from 'sonner'
import { useEditor, useEditorState, useEngineSubscription } from '@mcut/react'
import type { Project } from '@mcut/timeline'
import { Button } from '@/components/ui/button'
import { clearSavedSession, loadSavedSession, requestPersistentStorage, saveProjectSnapshot } from './persistence'

let persistenceRequested = false

function isProjectEmpty(project: Project): boolean {
  return Object.keys(project.assets).length === 0 && project.tracks.every((track) => track.elements.length === 0)
}

export function SessionPersistence() {
  const engine = useEditor()
  const projectEmpty = useEditorState((s) => isProjectEmpty(s.project))
  const [dismissed, setDismissed] = useState(false)
  const saved = useQuery({
    queryKey: ['mcut', 'saved-session'],
    queryFn: loadSavedSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  useEngineSubscription(
    engine.store,
    () => {
      if (!persistenceRequested) {
        persistenceRequested = true
        void requestPersistentStorage()
      }
      saveProjectSnapshot(engine.project).catch(() => {})
    },
    { debounceMs: 800 },
  )

  const session = saved.data
  if (dismissed || !projectEmpty || !session) return null
  return (
    <div
      role="dialog"
      aria-label="Restore previous session"
      className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
    >
      <span>Restore previous session?</span>
      <Button
        size="xs"
        onClick={() => {
          engine.loadProject(session.project)
          if (session.missingAssetIds.length > 0) {
            toast.warning(`${session.missingAssetIds.length} media file(s) could not be restored — re-import them.`)
          }
          setDismissed(true)
        }}
      >
        Restore
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void clearSavedSession()
          setDismissed(true)
        }}
      >
        Discard
      </Button>
    </div>
  )
}

function readPersistedLayout(key: string, resetToken: number): GroupProps['defaultLayout'] | undefined {
  void resetToken
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as GroupProps['defaultLayout']) : undefined
  } catch {
    return undefined
  }
}

export function usePersistedLayout(key: string, resetToken: number, enabled: boolean): Pick<GroupProps, 'defaultLayout' | 'onLayoutChanged'> {
  const defaultLayout = useMemo(() => (enabled ? readPersistedLayout(key, resetToken) : undefined), [enabled, key, resetToken])
  const onLayoutChanged = useCallback(
    (layout: Parameters<NonNullable<GroupProps['onLayoutChanged']>>[0]) => {
      if (!enabled) return
      try {
        window.localStorage.setItem(key, JSON.stringify(layout))
      } catch {}
    },
    [enabled, key],
  )
  return {
    ...(defaultLayout ? { defaultLayout } : {}),
    onLayoutChanged,
  }
}
