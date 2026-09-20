'use client'

import { useCallback, useMemo, useState, useSyncExternalStore, type RefObject } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { usePanelRef, type GroupProps, type PanelImperativeHandle } from 'react-resizable-panels'
import { CaptionsIcon, FolderOpenIcon, SearchIcon, SparklesIcon, TypeIcon } from '@/lib/icons'
import { toast } from 'sonner'
import { isWebGPUSupported } from '@mcut/compositor'
import {
  EditorProvider,
  PlayerCanvas,
  useDocumentRootAttribute,
  useDocumentRootClass,
  useEditor,
  useEditorState,
  useEngineSubscription,
  useWindowEvent,
} from '@mcut/react'
import { getElement, type Project } from '@mcut/timeline'
import type { TranscriptResult } from '@mcut/transcription'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { EditorDnd } from './editor-dnd'
import { EDITOR_LAYOUT_KEYS } from './editor-layout'
import { PanelCard, PanelHeader, PanelSectionLabel } from './editor-primitives'
import { EditorToolbar } from './editor-toolbar'
import { CurveEditorHost } from './easing-editor'
import { EditorUIProvider, useEditorUI, type EditorTheme, type LeftTab } from './editor-ui'
import { useProjectFontLoader } from './font-library'
import { LayoutBank } from './layout-bank'
import { LayoutSlotEditor } from './layout-slot-editor'
import { LiveMcpBridge } from './live-mcp-bridge'
import { TextEditOverlay } from './text-edit-overlay'
import { MediaBin } from './media-bin'
import { clearSavedSession, loadSavedSession, requestPersistentStorage, saveAssetBlob, saveProjectSnapshot } from './persistence'
import { PropertiesPanel } from './properties-panel'
import { TextPanel } from './text-panel'
import { TimelinePanel } from './timeline-panel'
import { TransportBar } from './transport-bar'

function isTypingTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
}

function ProjectFontLoader() {
  useProjectFontLoader()
  return null
}

function EditorHotkeys() {
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
      toast('Autosaved — projects persist in this browser')
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

let persistenceRequested = false

function isProjectEmpty(project: Project): boolean {
  return Object.keys(project.assets).length === 0 && project.tracks.every((track) => track.elements.length === 0)
}

function SessionPersistence() {
  const engine = useEditor()
  const projectEmpty = useEditorState((s) => isProjectEmpty(s.project))
  const [dismissed, setDismissed] = useState(false)
  const saved = useQuery({
    queryKey: ['mcut', 'saved-session'],
    queryFn: loadSavedSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

  useEngineSubscription(
    engine.store,
    () => {
      if (!persistenceRequested) {
        persistenceRequested = true
        void requestPersistentStorage()
      }
      saveProjectSnapshot(engine.project).catch(() => {})
    },
    { debounceMs: 800 },
  )

  const session = saved.data
  if (dismissed || !projectEmpty || !session) return null
  return (
    <div
      role="dialog"
      aria-label="Restore previous session"
      className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
    >
      <span>Restore previous session?</span>
      <Button
        size="xs"
        onClick={() => {
          engine.loadProject(session.project)
          if (session.missingAssetIds.length > 0) {
            toast.warning(`${session.missingAssetIds.length} media file(s) could not be restored — re-import them.`)
          }
          setDismissed(true)
        }}
      >
        Restore
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void clearSavedSession()
          setDismissed(true)
        }}
      >
        Discard
      </Button>
    </div>
  )
}

function readPersistedLayout(key: string, resetToken: number): GroupProps['defaultLayout'] | undefined {
  void resetToken
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as GroupProps['defaultLayout']) : undefined
  } catch {
    return undefined
  }
}

function usePersistedLayout(key: string, resetToken: number): Pick<GroupProps, 'defaultLayout' | 'onLayoutChanged'> {
  const defaultLayout = useMemo(() => readPersistedLayout(key, resetToken), [key, resetToken])
  const onLayoutChanged = useCallback(
    (layout: Parameters<NonNullable<GroupProps['onLayoutChanged']>>[0]) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(layout))
      } catch {}
    },
    [key],
  )
  return {
    ...(defaultLayout ? { defaultLayout } : {}),
    onLayoutChanged,
  }
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

function useHasHydrated(): boolean {
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
    <div className="flex w-13 shrink-0 flex-col items-center gap-2 pt-1">
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

function LeftPanel({ tab, transcribe }: { tab: LeftTab } & Pick<EditorShellProps, 'transcribe'>) {
  if (tab === 'media') {
    return (
      <PanelCard>
        <MediaBin onAssetImported={(asset, file) => void saveAssetBlob(asset, file)} />
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
      <ScrollArea className="min-h-0 min-w-0 flex-1 scroll-mask-y">{tab === 'text' ? <TextPanel /> : <AnimationsPanel />}</ScrollArea>
    </PanelCard>
  )
}

function usePreviewRenderer(): 'canvas2d' | 'webgpu' {
  const [renderer] = useState<'canvas2d' | 'webgpu'>(() => {
    if (typeof window === 'undefined') return 'canvas2d'
    const requested = new URLSearchParams(window.location.search).get('renderer')
    if (requested !== 'webgpu') return 'canvas2d'
    if (!isWebGPUSupported()) {
      setTimeout(() => {
        toast.error('This browser has no WebGPU (needs Chrome 113+, Safari 26+, or Firefox 141+) — using the canvas2d renderer.')
      }, 0)
      return 'canvas2d'
    }
    return 'webgpu'
  })
  return renderer
}

function EditorDocumentTheme({ theme }: { theme: EditorTheme }) {
  useDocumentRootAttribute('data-editor', '')
  useDocumentRootClass('dark', theme === 'dark')
  return null
}

function PreviewArea() {
  const engine = useEditor()
  const width = useEditorState((s) => s.project.width)
  const height = useEditorState((s) => s.project.height)
  const { mode, previewQuality, editingTextId, setEditingTextId } = useEditorUI()
  const renderer = usePreviewRenderer()
  return (
    <PanelCard className="flex flex-col">
      <div className="flex min-h-0 flex-1">
        {mode === 'multicam' && <LayoutBank />}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-4 [container-type:size]">
          <div
            className="relative w-full"
            style={{
              maxWidth: `min(100%, calc(100cqh * ${width / height} - ${(24 * width) / height}px))`,
              ['--mcut-aspect' as string]: `${width} / ${height}`,
            }}
          >
            <PlayerCanvas
              quality={previewQuality}
              renderer={renderer}
              className="overflow-hidden rounded-lg shadow-xl ring-1 ring-foreground/10"
              {...(editingTextId ? { hiddenElementIds: new Set([editingTextId]) } : {})}
              onElementDoubleClick={(elementId) => {
                const element = getElement(engine.project, elementId)
                if (element?.type === 'text') setEditingTextId(elementId)
              }}
            />
            {mode === 'multicam' && <LayoutSlotEditor />}
            <TextEditOverlay />
          </div>
        </div>
      </div>
      <TransportBar />
    </PanelCard>
  )
}

function TrackSorter({ children }: { children: React.ReactNode }) {
  const engine = useEditor()
  return (
    <EditorDnd
      onTrackSort={(activeTrackId, overTrackId) => {
        const toIndex = engine.project.tracks.findIndex((t) => t.id === overTrackId)
        if (toIndex === -1) return
        try {
          engine.dispatch({
            type: 'reorderTrack',
            trackId: activeTrackId as `t-${string}`,
            toIndex,
          })
        } catch {}
      }}
    >
      {children}
    </EditorDnd>
  )
}

export interface EditorShellProps {
  project?: Project
  transcribe?: (audio: Blob) => Promise<TranscriptResult>
}

function Shell({
  transcribe,
  leftPanelRef,
}: Pick<EditorShellProps, 'transcribe'> & {
  leftPanelRef: RefObject<PanelImperativeHandle | null>
}) {
  const { theme, leftTab: tab, setLeftTab: setTab, layoutResetToken } = useEditorUI()
  const panelsReady = useHasHydrated()
  const verticalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.vertical, layoutResetToken)
  const horizontalLayout = usePersistedLayout(EDITOR_LAYOUT_KEYS.horizontal, layoutResetToken)
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
    <div data-editor="" className={cn('flex h-dvh flex-col overflow-hidden bg-background text-foreground', theme === 'dark' && 'dark')}>
      <EditorDocumentTheme theme={theme} />
      <EditorHotkeys />
      <CommandPalette />
      <CurveEditorHost />
      <SessionPersistence />
      <ProjectFontLoader />
      <LiveMcpBridge />
      <EditorToolbar />
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
                    <LeftPanel tab={tab} transcribe={transcribe} />
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
      <Toaster position="bottom-right" />
    </div>
  )
}

export function EditorShell({ project, transcribe }: EditorShellProps) {
  const [queryClient] = useState(() => new QueryClient())
  const leftPanelRef = usePanelRef()
  return (
    <QueryClientProvider client={queryClient}>
      <EditorProvider {...(project ? { project } : {})}>
        <EditorUIProvider leftPanelRef={leftPanelRef}>
          <TooltipProvider>
            <Shell transcribe={transcribe} leftPanelRef={leftPanelRef} />
          </TooltipProvider>
        </EditorUIProvider>
      </EditorProvider>
    </QueryClientProvider>
  )
}
