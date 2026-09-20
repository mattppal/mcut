'use client'

import { useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { CaptionsIcon, FolderOpenIcon, SearchIcon, SparklesIcon, TypeIcon } from '@/lib/icons'
import { toast } from 'sonner'
import { EditorProvider, useDocumentRootAttribute, useDocumentRootClass, useEditor, useWindowEvent } from '@mcut/react'
import type { Project } from '@mcut/timeline'
import type { TranscriptResult } from '@mcut/transcription'
import { cn } from '@/lib/utils'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import './editor-default-actions'
import { actionForEvent, isActionEnabled, runEditorAction, type ActionContext } from './action-registry'
import { editorClipboard } from './editor-clipboard'
import { AnimationsPanel } from './animations-panel'
import { CaptionsPanel } from './captions-panel'
import { TranscriptPanel } from './transcript-panel'
import { CommandPalette } from './command-palette'
import { EDITOR_LAYOUT_KEYS } from './editor-layout'
import { PanelCard, PanelHeader, PanelSectionLabel } from './editor-primitives'
import { SessionPersistence, usePersistedLayout } from './editor-session'
import { EditorToolbar } from './editor-toolbar'
import { CurveEditorHost } from './easing-editor'
import { EditorUIProvider, useEditorUI, type EditorTheme, type LeftTab } from './editor-ui'
import type { EmbedOptions } from './embed'
import { EmbedShell } from './embed-shell'
import { useProjectFontLoader } from './font-library'
import { LiveMcpBridge } from './live-mcp-bridge'
import { MediaBin } from './media-bin'
import { saveAssetBlob } from './persistence'
import { PreviewArea, TrackSorter } from './preview-area'
import { PropertiesPanel } from './properties-panel'
import { host } from './studio-host'
import { TextPanel } from './text-panel'
import { TimelinePanel } from './timeline-panel'

function isTypingTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
}

function ProjectFontLoader() {
  useProjectFontLoader()
  return null
}

function EditorHotkeys({ persist }: { persist: boolean }) {
  const engine = useEditor()
  const ui = useEditorUI()
  useWindowEvent('keydown', (event) => {
    if (isTypingTarget(event.target)) {
      if (event.key === 'Escape') event.target.blur()
      return
    }
    if (event.key === 'Escape') {
      engine.clearSelection()
      return
    }
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (persist) toast('Autosaved — projects persist in this browser')
      return
    }
    const action = actionForEvent(event)
    if (!action) return
    event.preventDefault()
    const context: ActionContext = { engine, ui, clipboard: editorClipboard }
    if (isActionEnabled(action, context)) runEditorAction(action, context)
  })
  useWindowEvent('mcut:run-action', (event) => {
    runEditorAction(event.detail, { engine, ui, clipboard: editorClipboard })
  })
  return null
}

function subscribeHydration(onStoreChange: () => void): () => void {
  const id = window.setTimeout(onStoreChange, 0)
  return () => window.clearTimeout(id)
}

function clientHydrationSnapshot(): boolean {
  return true
}

function serverHydrationSnapshot(): boolean {
  return false
}

export function useHasHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, clientHydrationSnapshot, serverHydrationSnapshot)
}

const LEFT_TABS: Array<{ id: LeftTab; label: string; icon: typeof FolderOpenIcon }> = [
  { id: 'media', label: 'Media', icon: FolderOpenIcon },
  { id: 'text', label: 'Text', icon: TypeIcon },
  { id: 'animate', label: 'Animate', icon: SparklesIcon },
  { id: 'captions', label: 'Captions', icon: CaptionsIcon },
  { id: 'transcript', label: 'Find', icon: SearchIcon },
]

function ChromeRail({ tab, collapsed, onSelect }: { tab: LeftTab; collapsed: boolean; onSelect: (tab: LeftTab) => void }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-2">
      {LEFT_TABS.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-rail-tab={id}
                aria-label={collapsed ? `Show ${label.toLowerCase()}` : label}
                aria-pressed={tab === id && !collapsed}
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg transition-colors',
                  tab === id && !collapsed ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                )}
                onClick={() => onSelect(id)}
              />
            }
          >
            <Icon className="size-5" />
          </TooltipTrigger>
          <TooltipContent side="right">{collapsed ? `Show ${label.toLowerCase()}` : label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function LeftPanel({ tab, transcribe, persist }: { tab: LeftTab; persist: boolean } & Pick<EditorShellProps, 'transcribe'>) {
  if (tab === 'media') {
    return (
      <PanelCard>
        <MediaBin {...(persist ? { onAssetImported: (asset, file) => void saveAssetBlob(asset, file) } : {})} />
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

function EditorDocumentTheme({ theme }: { theme: EditorTheme }) {
  useDocumentRootAttribute('data-editor', '')
  useDocumentRootAttribute('data-window-chrome', host.windowChrome)
  useDocumentRootClass('dark', theme === 'dark')
  return null
}

export interface EditorShellProps {
  project?: Project
  transcribe?: (audio: Blob) => Promise<TranscriptResult>
  embed?: EmbedOptions
}

function Workspace({
  transcribe,
  leftPanelRef,
  persist,
}: Pick<EditorShellProps, 'transcribe'> & {
  leftPanelRef: RefObject<PanelImperativeHandle | null>
  persist: boolean
}) {
  const { leftTab: tab, setLeftTab: setTab, layoutResetToken } = useEditorUI()
  const panelsReady = useHasHydrated()
  const verticalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.vertical, layoutResetToken, persist)
  const horizontalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.horizontal, layoutResetToken, persist)
  const [leftCollapsed, setLeftCollapsed] = useState(false)

  const onRailSelect = (next: LeftTab) => {
    const panel = leftPanelRef.current
    if (panel?.isCollapsed()) {
      panel.expand()
      setTab(next)
      return
    }
    if (next === tab) {
      panel?.collapse()
      return
    }
    setTab(next)
  }

  return (
    <>
      <EditorToolbar embedded={!persist} />
      <div className="flex min-h-0 flex-1">
        <ChromeRail tab={tab} collapsed={leftCollapsed} onSelect={onRailSelect} />
        {panelsReady ? (
          <TrackSorter>
            <ResizablePanelGroup key={`vertical-${layoutResetToken}`} orientation="vertical" className="min-h-0 flex-1 pr-2 pb-2" {...verticalLayout}>
              <ResizablePanel id="workspace" defaultSize="62%" minSize="30%">
                <ResizablePanelGroup key={`horizontal-${layoutResetToken}`} orientation="horizontal" {...horizontalLayout}>
                  <ResizablePanel
                    id="left"
                    defaultSize="22%"
                    minSize="14%"
                    collapsible
                    panelRef={leftPanelRef}
                    onResize={(size) => setLeftCollapsed(size.asPercentage === 0)}
                  >
                    <LeftPanel tab={tab} transcribe={transcribe} persist={persist} />
                  </ResizablePanel>
                  <ResizableHandle className={leftCollapsed ? 'hidden' : undefined} />
                  <ResizablePanel id="preview" defaultSize="56%" minSize="30%">
                    <PreviewArea />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel id="inspector" defaultSize="22%" minSize="14%" collapsible>
                    <PanelCard>
                      <ScrollArea className="h-full scroll-mask-b">
                        <PropertiesPanel />
                      </ScrollArea>
                    </PanelCard>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel id="timeline" defaultSize="38%" minSize="18%">
                <PanelCard>
                  <TimelinePanel className="h-full" />
                </PanelCard>
              </ResizablePanel>
            </ResizablePanelGroup>
          </TrackSorter>
        ) : (
          <div className="min-h-0 flex-1 pr-2 pb-2">
            <PanelCard className="flex items-center justify-center text-xs text-muted-foreground">
              <span>Loading editor...</span>
            </PanelCard>
          </div>
        )}
      </div>
    </>
  )
}

function Shell({ persist, children }: { persist: boolean; children: ReactNode }) {
  const { theme } = useEditorUI()
  return (
    <div data-editor="" className={cn('flex h-dvh flex-col overflow-hidden bg-background text-foreground', theme === 'dark' && 'dark')}>
      <EditorDocumentTheme theme={theme} />
      <EditorHotkeys persist={persist} />
      <CommandPalette />
      <CurveEditorHost />
      <ProjectFontLoader />
      {children}
      <Toaster position="bottom-right" />
    </div>
  )
}

export function EditorShell({ project, transcribe, embed }: EditorShellProps) {
  const [queryClient] = useState(() => new QueryClient())
  const leftPanelRef = usePanelRef()
  const persist = embed === undefined
  const workspace = <Workspace transcribe={transcribe} leftPanelRef={leftPanelRef} persist={persist} />
  return (
    <QueryClientProvider client={queryClient}>
      <EditorProvider {...(project ? { project } : {})}>
        <EditorUIProvider leftPanelRef={leftPanelRef}>
          <TooltipProvider>
            <Shell persist={persist}>
              {embed ? (
                <EmbedShell options={embed}>{workspace}</EmbedShell>
              ) : (
                <>
                  <SessionPersistence />
                  <LiveMcpBridge />
                  {workspace}
                </>
              )}
            </Shell>
          </TooltipProvider>
        </EditorUIProvider>
      </EditorProvider>
    </QueryClientProvider>
  )
}
