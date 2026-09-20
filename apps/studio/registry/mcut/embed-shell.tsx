'use client'

import { useState, type ReactNode } from 'react'
import { PanelCard } from './editor-primitives'
import type { EmbedOptions } from './embed'
import { EmbedBootstrap } from './embed-bootstrap'
import { PreviewArea, TrackSorter } from './preview-area'
import { TimelinePanel } from './timeline-panel'

type EmbedLayout = 'compact' | 'full'

function CompactWorkspace() {
  return (
    <TrackSorter>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="min-h-0 flex-[68_1_0%]">
          <PreviewArea />
        </div>
        <PanelCard className="flex-[32_1_0%]">
          <TimelinePanel className="h-full" />
        </PanelCard>
      </div>
    </TrackSorter>
  )
}

export function EmbedShell({ options, children }: { options: EmbedOptions; children: ReactNode }) {
  const [layout, setLayout] = useState<EmbedLayout>('compact')
  return (
    <>
      <EmbedBootstrap options={options} loop={layout === 'compact'} onLayout={(compact) => setLayout(compact ? 'compact' : 'full')} />
      {layout === 'compact' ? <CompactWorkspace /> : children}
    </>
  )
}
