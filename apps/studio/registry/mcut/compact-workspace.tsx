'use client'

import { useState } from 'react'
import { SlidersHorizontalIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PanelCard } from './editor-primitives'
import { EditorToolbar } from './editor-toolbar'
import { useEditorUI, type LeftTab } from './editor-ui'
import { LEFT_TABS, LeftPanel, type LeftPanelProps } from './left-panel'
import { PreviewArea, TrackSorter } from './preview-area'
import { PropertiesPanel } from './properties-panel'
import { TimelinePanel } from './timeline-panel'

type CompactPanel = LeftTab | 'inspector'

type CompactSheet = { open: true; panel: CompactPanel } | { open: false; panel: CompactPanel | null }

const COMPACT_TABS: Array<{ id: CompactPanel; label: string; icon: typeof SlidersHorizontalIcon }> = [
  ...LEFT_TABS,
  { id: 'inspector', label: 'Inspect', icon: SlidersHorizontalIcon },
]

function CompactTabBar({ active, onSelect }: { active: CompactPanel | null; onSelect: (panel: CompactPanel) => void }) {
  return (
    <div data-slot="compact-tab-bar" className="flex h-14 shrink-0 items-stretch gap-1 bg-background px-2 py-1">
      {COMPACT_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          data-rail-tab={id}
          aria-pressed={active === id}
          className={cn(
            'flex min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-2xs font-medium transition-colors',
            active === id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
          )}
          onClick={() => onSelect(id)}
        >
          <Icon className="size-5" />
          {label}
        </button>
      ))}
    </div>
  )
}

function SheetBody({ panel, transcribe, omitted }: { panel: CompactPanel } & Omit<LeftPanelProps, 'tab'>) {
  if (panel === 'inspector') {
    return (
      <PanelCard>
        <ScrollArea className="h-full scroll-mask-b">
          <PropertiesPanel />
        </ScrollArea>
      </PanelCard>
    )
  }
  return <LeftPanel tab={panel} transcribe={transcribe} omitted={omitted} />
}

export function CompactWorkspace({ transcribe, omitted }: Omit<LeftPanelProps, 'tab'>) {
  const { setLeftTab } = useEditorUI()
  const [sheet, setSheet] = useState<CompactSheet>({ open: false, panel: null })
  const active = sheet.open ? sheet.panel : null
  const label = COMPACT_TABS.find((tab) => tab.id === sheet.panel)?.label ?? ''

  const toggleSheet = (panel: CompactPanel) => {
    if (panel === active) {
      setSheet({ open: false, panel })
      return
    }
    if (panel !== 'inspector') setLeftTab(panel)
    setSheet({ open: true, panel })
  }

  return (
    <TrackSorter>
      <div className="flex h-full min-h-0 flex-col">
        <EditorToolbar />
        <div className="min-h-0 flex-1 px-2">
          <PreviewArea />
        </div>
        <div className="basis-[38%] shrink-0 p-2">
          <PanelCard>
            <TimelinePanel className="h-full" />
          </PanelCard>
        </div>
        <CompactTabBar active={active} onSelect={toggleSheet} />
        <Dialog
          open={sheet.open}
          onOpenChange={(open) => {
            if (!open) setSheet({ open: false, panel: sheet.panel })
          }}
        >
          <DialogContent
            data-slot="compact-sheet"
            showCloseButton={false}
            className="top-auto bottom-0 left-0 flex h-[70dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-b-none p-0 transition-[opacity,translate,scale] sm:max-w-none data-starting-style:translate-y-4 data-ending-style:translate-y-4"
          >
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <div className="min-h-0 flex-1">
              {sheet.panel !== null && <SheetBody panel={sheet.panel} transcribe={transcribe} omitted={omitted} />}
            </div>
            <CompactTabBar active={active} onSelect={toggleSheet} />
          </DialogContent>
        </Dialog>
      </div>
    </TrackSorter>
  )
}
