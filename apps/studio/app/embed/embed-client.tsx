'use client'

import { useState } from 'react'
import type { TranscriptResult } from '@mcut/transcription'
import { EditorShell, useHasHydrated } from '@/registry/mcut/editor-shell'
import { readEmbedOptions, type EmbedOptions } from '@/registry/mcut/embed'
import { isLocalTranscriptionSupported, isOnDeviceTranscriptionEnabled, transcribeOnDevice } from '@/registry/mcut/local-transcription'

function readOptions(): EmbedOptions | null {
  return typeof window === 'undefined' ? null : readEmbedOptions(window.location.search)
}

function transcribeInEmbed(audio: Blob): Promise<TranscriptResult> {
  if (!isLocalTranscriptionSupported()) {
    return Promise.reject(new Error('Captions here run on this device and need WebGPU. Download Studio to caption with a cloud provider.'))
  }
  if (!isOnDeviceTranscriptionEnabled()) {
    return Promise.reject(new Error('Turn on "Transcribe on this device" first. The site has no cloud transcription.'))
  }
  return transcribeOnDevice(audio)
}

export function EmbedClient() {
  const hydrated = useHasHydrated()
  const [options] = useState(readOptions)
  if (!hydrated) return null
  if (options === null) return <p className="p-4 text-sm text-muted-foreground">Missing clip</p>
  return <EditorShell embed={options} transcribe={transcribeInEmbed} />
}
