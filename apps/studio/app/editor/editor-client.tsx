'use client'

import { EditorShell } from '@/registry/mcut/editor-shell'
import { transcribe } from './transcribe'

export function EditorClient() {
  return <EditorShell transcribe={transcribe} />
}
