'use client'

import type { MCP_TOOL_INPUTS } from '@mcut/mcp-server/contract'
import { getElement, type AssetId, type AssetRef, type EditorEngine, type ElementId } from '@mcut/timeline'
import type { z } from 'zod'
import { voiceStems } from './voice-cleanup'
import { voicedElements, type StemStatus, type VoiceStems } from './voice-stems'

type EnsureVoiceStemsPayload = z.infer<typeof MCP_TOOL_INPUTS.ensure_voice_stems>

export type VoiceStemReport = { id: ElementId; assetId: AssetId } & (
  | { status: 'ready'; processingMs: number }
  | { status: 'processing'; progress: number }
  | { status: 'failed'; error: string }
)

function pickVoiced(engine: EditorEngine, elementIds: readonly ElementId[] | undefined): { elementId: ElementId; asset: AssetRef }[] {
  const voiced = voicedElements(engine.project)
  if (!elementIds) return voiced
  return elementIds.map((id) => {
    const match = voiced.find(({ elementId }) => elementId === id)
    if (match) return match
    if (!getElement(engine.project, id)) throw new Error(`No clip "${id}" in the project.`)
    throw new Error(`Clip "${id}" does not have Clean up voice on. Turn it on with updateElement or the audio.cleanVoice operator first.`)
  })
}

function report(id: ElementId, assetId: AssetId, stem: StemStatus): VoiceStemReport {
  switch (stem.state) {
    case 'ready':
      return { id, assetId, status: 'ready', processingMs: stem.processingMs }
    case 'processing':
      return { id, assetId, status: 'processing', progress: stem.progress }
    case 'failed':
      return { id, assetId, status: 'failed', error: stem.error }
    case 'idle':
      throw new Error(`Clean up voice did not start for clip "${id}".`)
    default: {
      const unhandled: never = stem
      throw new Error(`Unknown voice stem state ${JSON.stringify(unhandled)}.`)
    }
  }
}

export async function ensureVoiceStemsForBridge(
  engine: EditorEngine,
  { elementIds, wait = true }: EnsureVoiceStemsPayload,
  stems: VoiceStems = voiceStems,
): Promise<{ elements: VoiceStemReport[] }> {
  const targets = pickVoiced(engine, elementIds)
  for (const { asset } of targets) stems.start(asset)
  if (wait) await stems.settled(targets.map(({ asset }) => asset))
  return { elements: targets.map(({ elementId, asset }) => report(elementId, asset.id, stems.status(asset))) }
}
