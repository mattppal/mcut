'use client'

import { CaptionsIcon, FolderOpenIcon, SearchIcon, SparklesIcon, TypeIcon } from '@/lib/icons'
import type { TranscriptResult } from '@mcut/transcription'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AnimationsPanel } from './animations-panel'
import { CaptionsPanel } from './captions-panel'
import { PanelCard, PanelHeader, PanelSectionLabel } from './editor-primitives'
import type { LeftTab } from './editor-ui'
import type { EmbedOmission } from './embed'
import { MediaBin } from './media-bin'
import { saveAssetBlob } from './persistence'
import { TextPanel } from './text-panel'
import { TranscriptPanel } from './transcript-panel'

export const LEFT_TABS: Array<{ id: LeftTab; label: string; icon: typeof FolderOpenIcon }> = [
  { id: 'media', label: 'Media', icon: FolderOpenIcon },
  { id: 'text', label: 'Text', icon: TypeIcon },
  { id: 'animate', label: 'Animate', icon: SparklesIcon },
  { id: 'captions', label: 'Captions', icon: CaptionsIcon },
  { id: 'transcript', label: 'Find', icon: SearchIcon },
]

export interface LeftPanelProps {
  tab: LeftTab
  transcribe?: (audio: Blob) => Promise<TranscriptResult>
  omitted: ReadonlySet<EmbedOmission>
}

export function LeftPanel({ tab, transcribe, omitted }: LeftPanelProps) {
  if (tab === 'media') {
    return (
      <PanelCard>
        <MediaBin {...(!omitted.has('session-persistence') ? { onAssetImported: (asset, file) => void saveAssetBlob(asset, file) } : {})} />
      </PanelCard>
    )
  }
  if (tab === 'captions') {
    return (
      <PanelCard>
        <CaptionsPanel transcribe={transcribe} />
      </PanelCard>
    )
  }
  if (tab === 'transcript') {
    return (
      <PanelCard>
        <TranscriptPanel transcribe={transcribe} />
      </PanelCard>
    )
  }
  return (
    <PanelCard className="flex flex-col">
      <PanelHeader>
        <PanelSectionLabel>{tab === 'text' ? 'Text' : 'Animate'}</PanelSectionLabel>
      </PanelHeader>
      <ScrollArea className="min-h-0 min-w-0 flex-1 scroll-mask-b">{tab === 'text' ? <TextPanel /> : <AnimationsPanel />}</ScrollArea>
    </PanelCard>
  )
}
