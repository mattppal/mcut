'use client'

import { useSyncExternalStore } from 'react'
import { extractAudioToWav, isMediaStoreSupported } from '@mcut/media'
import { useEditorContext, useEngineSync } from '@mcut/react'
import type { AssetId } from '@mcut/timeline'
import { VOICE_SAMPLE_RATE, cleanVoice, decodeWav } from '@mcut/voice/browser'
import { IDLE, createVoiceStems, type StemStatus } from './voice-stems'

const STEM_DIR = 'mcut-voice'

async function stemDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!isMediaStoreSupported()) return null
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(STEM_DIR, { create: true })
}

async function loadStem(name: string): Promise<Blob | null> {
  const dir = await stemDir()
  if (!dir) return null
  try {
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function saveStem(name: string, wav: Blob): Promise<void> {
  const dir = await stemDir()
  if (!dir) return
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(wav)
  await writable.close()
}

async function decodeVoice(src: string): Promise<Float32Array> {
  const wav = await extractAudioToWav(src, { sampleRate: VOICE_SAMPLE_RATE, numberOfChannels: 1 })
  if (!wav) throw new Error('This clip has no audio track.')
  const { samples, sampleRate } = decodeWav(new Uint8Array(await wav.arrayBuffer()))
  if (sampleRate !== VOICE_SAMPLE_RATE) throw new Error(`The clip's audio decoded at ${sampleRate} Hz and voice cleanup needs ${VOICE_SAMPLE_RATE} Hz.`)
  return samples
}

export const voiceStems = createVoiceStems({
  decode: decodeVoice,
  clean: (samples, onProgress) => cleanVoice(samples, { onProgress: ({ done, total }) => onProgress(total > 0 ? done / total : 1) }),
  load: loadStem,
  save: saveStem,
})

const subscribeStems = (onChange: () => void) => voiceStems.subscribe(onChange).unsubscribe

export function useVoiceStem(assetId: AssetId | undefined): StemStatus {
  return useSyncExternalStore(
    subscribeStems,
    () => (assetId ? voiceStems.status(assetId) : IDLE),
    () => IDLE,
  )
}

export function VoiceStemSync(): null {
  const { engine, pool } = useEditorContext()
  const publish = (): void => pool.setAudioSources(voiceStems.audioSources(engine.project))
  useEngineSync(
    engine.store,
    (state) => state.project,
    (project) => {
      voiceStems.reconcile(project)
      publish()
    },
  )
  useEngineSync(voiceStems, (state) => state, publish)
  return null
}
