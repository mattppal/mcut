'use client'

import { useState } from 'react'
import { EditorShell, useHasHydrated } from '@/registry/mcut/editor-shell'
import { readEmbedOptions, type EmbedOptions } from '@/registry/mcut/embed'
import { transcribe } from '@/app/editor/transcribe'

function readOptions(): EmbedOptions | null {
  return typeof window === 'undefined' ? null : readEmbedOptions(window.location.search)
}

export function EmbedClient() {
  const hydrated = useHasHydrated()
  const [options] = useState(readOptions)
  if (!hydrated) return null
  if (options === null) return <p className="p-4 text-sm text-muted-foreground">Missing clip</p>
  return <EditorShell embed={options} transcribe={transcribe} />
}
