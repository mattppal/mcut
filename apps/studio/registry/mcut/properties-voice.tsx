'use client'

import { useState } from 'react'
import { useEditor, useProject } from '@mcut/react'
import { getVoiceSource, type AudioElement, type MulticamElement, type VideoElement, type Voice } from '@mcut/timeline'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { FieldRow } from './inspector-fields'
import { useVoiceStem } from './voice-cleanup'

export function VoiceFields({ element }: { element: VideoElement | AudioElement | MulticamElement }) {
  const engine = useEditor()
  const project = useProject()
  const stem = useVoiceStem(getVoiceSource(project, element)?.assetId)
  const [draft, setDraft] = useState<number | null>(null)
  const voice = element.voice
  const amount = draft ?? Math.round((voice?.amount ?? 1) * 100)
  const commit = (next: Voice) => engine.dispatch({ type: 'updateElement', elementId: element.id, patch: { voice: next } })
  return (
    <div className="flex flex-col gap-1.5" data-mcut-voice-stem={stem.state}>
      <FieldRow label="Clean up voice" title="Removes background noise from speech, on this device. Room echo stays.">
        <Switch aria-label="Clean up voice" checked={voice?.enabled ?? false} onCheckedChange={(enabled) => commit({ enabled, amount: voice?.amount ?? 1 })} />
      </FieldRow>
      {voice?.enabled && (
        <FieldRow label="Amount">
          <Slider
            aria-label="Clean up voice amount"
            className="flex-1"
            value={[amount]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => setDraft(Array.isArray(value) ? (value[0] ?? 0) : value)}
            onValueCommitted={(value) => {
              setDraft(null)
              commit({ enabled: true, amount: (Array.isArray(value) ? (value[0] ?? 0) : value) / 100 })
            }}
          />
          <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{amount}%</span>
        </FieldRow>
      )}
      {voice?.enabled && stem.state === 'processing' && <p className="text-2xs text-muted-foreground">Cleaning voice… {Math.round(stem.progress * 100)}%</p>}
      {voice?.enabled && stem.state === 'failed' && <p className="text-2xs text-destructive">Voice cleanup failed. {stem.error}</p>}
    </div>
  )
}
